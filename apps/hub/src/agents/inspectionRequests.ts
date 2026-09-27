import { Context, Duration, Effect, Layer, SubscriptionRef } from "effect";

import { HubCommand } from "@fleetfrog/protocol/agent/rpcs";
import { InspectionResult } from "@fleetfrog/protocol/domain/trash";

import { makeAgentQueries } from "./agentQueries.ts";
import { AgentSessions } from "./agentSessions.ts";

import type { MachineId } from "@fleetfrog/protocol/domain/machine";

function failed(message: string): InspectionResult {
  return InspectionResult.cases.Failed.make({ message });
}

/**
 * Asks agents what deleting a checkout, or removing one of its linked worktrees, would lose and
 * waits for each answer.
 */
export class InspectionRequests extends Context.Service<
  InspectionRequests,
  {
    readonly inspect: (request: {
      readonly machineId: MachineId;
      readonly path: string;
      /** A linked worktree of the checkout at `path` to inspect instead. */
      readonly worktree: string | null;
    }) => Effect.Effect<InspectionResult>;
    /** Takes an agent's answer. Only the machine that was asked can answer. */
    readonly answer: (answer: {
      readonly machineId: MachineId;
      readonly requestId: string;
      readonly result: InspectionResult;
    }) => Effect.Effect<void>;
  }
>()("fleetfrog/InspectionRequests") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const sessions = yield* AgentSessions;
      // The agent fetches every remote and measures the checkout, which can take a while.
      const queries = makeAgentQueries({ timeout: Duration.minutes(3), unanswered: failed });

      return {
        inspect: Effect.fn("InspectionRequests.inspect")(function* ({ machineId, path, worktree }) {
          const agent = (yield* SubscriptionRef.get(sessions.online)).get(machineId);

          if (agent === undefined) {
            return failed("The machine is offline.");
          }

          // Inspections came with the Trash action, so an agent that has it can inspect.
          if (!agent.capabilities.actions.includes("Trash")) {
            return failed("The machine's agent needs updating before it can inspect checkouts.");
          }

          const result = yield* queries.ask(machineId, (requestId) =>
            sessions.send(machineId, HubCommand.cases.Inspect.make({ requestId, path, worktree })),
          );

          // An agent too old to know `worktree` inspects the whole checkout instead.
          return worktree !== null && result._tag === "Inspected"
            ? failed("The machine's agent needs updating before it can inspect worktrees.")
            : result;
        }),
        answer: ({ machineId, requestId, result }) =>
          queries.answer({ machineId, requestId, value: result }),
      };
    }),
  );
}
