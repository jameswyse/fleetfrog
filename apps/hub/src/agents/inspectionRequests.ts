import { Context, Duration, Effect, Layer, SubscriptionRef } from "effect";

import { HubCommand } from "@fleetfrog/protocol/agent/rpcs";
import { InspectionResult } from "@fleetfrog/protocol/domain/trash";

import { makeAgentQueries } from "./agentQueries.ts";
import { AgentSessions } from "./agentSessions.ts";

import type { MachineId } from "@fleetfrog/protocol/domain/machine";

function failed(message: string): InspectionResult {
  return InspectionResult.cases.Failed.make({ message });
}

/** Asks agents what deleting a checkout would lose and waits for each answer. */
export class InspectionRequests extends Context.Service<
  InspectionRequests,
  {
    readonly inspect: (machineId: MachineId, path: string) => Effect.Effect<InspectionResult>;
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
        inspect: Effect.fn("InspectionRequests.inspect")(function* (machineId, path) {
          const agent = (yield* SubscriptionRef.get(sessions.online)).get(machineId);

          if (agent === undefined) {
            return failed("The machine is offline.");
          }

          if (!agent.capabilities.actions.includes("Trash")) {
            return failed("The machine's agent needs updating before it can inspect checkouts.");
          }

          return yield* queries.ask(machineId, (requestId) =>
            sessions.send(machineId, HubCommand.cases.Inspect.make({ requestId, path })),
          );
        }),
        answer: ({ machineId, requestId, result }) =>
          queries.answer({ machineId, requestId, value: result }),
      };
    }),
  );
}
