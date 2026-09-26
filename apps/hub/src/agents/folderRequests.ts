import { randomUUID } from "node:crypto";

import { Context, Deferred, Duration, Effect, Layer, SubscriptionRef } from "effect";

import { HubCommand } from "@fleetfrog/protocol/agent/rpcs";
import { FolderOutcome } from "@fleetfrog/protocol/domain/fleet";

import { AgentSessions } from "./agentSessions.ts";

import type { MachineId } from "@fleetfrog/protocol/domain/machine";

/** Creating a folder is quick, so an agent that takes longer than this has gone quiet. */
const answerTimeout = Duration.seconds(20);

function failed(message: string): FolderOutcome {
  return FolderOutcome.cases.Failed.make({ message });
}

interface Pending {
  readonly machineId: MachineId;
  readonly answer: Deferred.Deferred<FolderOutcome>;
}

/**
 * Asks agents to create their missing project folders and waits for each answer. The command and
 * its answer travel separately, matched by a request id.
 */
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
      const pending = new Map<string, Pending>();

      return {
        create: (machineId, path) =>
          Effect.gen(function* () {
            const agent = (yield* SubscriptionRef.get(sessions.online)).get(machineId);

            if (agent === undefined) {
              return failed("The machine is offline.");
            }

            if (!agent.capabilities.createsFolders) {
              return failed("The machine's agent needs updating before it can create folders.");
            }

            const requestId = randomUUID();
            const answer = yield* Deferred.make<FolderOutcome>();

            pending.set(requestId, { machineId, answer });

            return yield* sessions
              .send(machineId, HubCommand.cases.CreateFolder.make({ requestId, path }))
              .pipe(
                Effect.flatMap((sent) =>
                  sent === null
                    ? Effect.succeed(failed("The machine is offline."))
                    : Deferred.await(answer).pipe(
                        Effect.timeoutOrElse({
                          duration: answerTimeout,
                          orElse: () =>
                            Effect.succeed(failed("The machine didn't answer in time.")),
                        }),
                      ),
                ),
                // An answer that never comes, or comes too late, leaves nothing behind.
                Effect.ensuring(Effect.sync(() => pending.delete(requestId))),
              );
          }),
        answer: ({ machineId, requestId, outcome }) =>
          Effect.suspend(() => {
            const request = pending.get(requestId);

            if (request === undefined || request.machineId !== machineId) {
              return Effect.void;
            }

            pending.delete(requestId);

            return Deferred.succeed(request.answer, outcome).pipe(Effect.asVoid);
          }),
      };
    }),
  );
}
