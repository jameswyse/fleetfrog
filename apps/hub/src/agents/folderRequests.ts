import { Context, Duration, Effect, Layer, SubscriptionRef } from "effect";

import { HubCommand } from "@fleetfrog/protocol/agent/rpcs";
import { FolderOutcome } from "@fleetfrog/protocol/domain/fleet";

import { makeAgentQueries } from "./agentQueries.ts";
import { AgentSessions } from "./agentSessions.ts";

import type { MachineId } from "@fleetfrog/protocol/domain/machine";

function failed(message: string): FolderOutcome {
  return FolderOutcome.cases.Failed.make({ message });
}

/** Asks agents to create their missing project folders and waits for each answer. */
export class FolderRequests extends Context.Service<
  FolderRequests,
  {
    /** Creates one of the machine's project folders, or says why it couldn't. */
    readonly create: (machineId: MachineId, path: string) => Effect.Effect<FolderOutcome>;
    /** Takes an agent's answer. Only the machine that was asked can answer. */
    readonly answer: (answer: {
      readonly machineId: MachineId;
      readonly requestId: string;
      readonly outcome: FolderOutcome;
    }) => Effect.Effect<void>;
  }
>()("fleetfrog/FolderRequests") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const sessions = yield* AgentSessions;
      // Creating a folder is quick, so an agent that takes longer than this has gone quiet.
      const queries = makeAgentQueries({ timeout: Duration.seconds(20), unanswered: failed });

      return {
        create: Effect.fn("FolderRequests.create")(function* (machineId, path) {
          const agent = (yield* SubscriptionRef.get(sessions.online)).get(machineId);

          if (agent === undefined) {
            return failed("The machine is offline.");
          }

          if (!agent.capabilities.createsFolders) {
            return failed("The machine's agent needs updating before it can create folders.");
          }

          return yield* queries.ask(machineId, (requestId) =>
            sessions.send(machineId, HubCommand.cases.CreateFolder.make({ requestId, path })),
          );
        }),
        answer: ({ machineId, requestId, outcome }) =>
          queries.answer({ machineId, requestId, value: outcome }),
      };
    }),
  );
}
