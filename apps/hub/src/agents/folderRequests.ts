import { Context, Duration, Effect, Layer, SubscriptionRef } from "effect";

import { HubCommand } from "@fleetfrog/protocol/agent/rpcs";
import { FolderOutcome } from "@fleetfrog/protocol/domain/fleet";

// oxlint-disable-next-line wyse/no-service-constructor-imports -- Each request kind builds queries with its own timeout.
import { makeAgentQueries } from "./agentQueries.ts";
import { AgentSessions } from "./agentSessions.ts";

import type { MachineId } from "@fleetfrog/protocol/domain/machine";

function failed(message: string): FolderOutcome {
  return FolderOutcome.cases.Failed.make({ message });
}

export class FolderRequests extends Context.Service<
  FolderRequests,
  {
    readonly create: (machineId: MachineId, path: string) => Effect.Effect<FolderOutcome>;
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
