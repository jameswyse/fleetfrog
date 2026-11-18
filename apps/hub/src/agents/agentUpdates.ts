import { Context, DateTime, Effect, Layer, Option, SubscriptionRef } from "effect";

import { HubCommand } from "@fleetfrog/protocol/agent/rpcs";
import { AgentNotUpdatable } from "@fleetfrog/protocol/dashboard/rpcs";
import {
  AgentUpdate,
  canUpdateAgent,
  compareVersions,
} from "@fleetfrog/protocol/domain/agentUpdate";
import { Connection } from "@fleetfrog/protocol/domain/fleet";

import packageJson from "../../package.json" with { type: "json" };
import { MachineStore } from "../machines/machineStore.ts";
import { AgentSessions } from "./agentSessions.ts";
import { clear, keep, set, transitionUpdate, withUpdate } from "./updateTransitions.ts";

import type { MachineNotFound } from "@fleetfrog/protocol/dashboard/rpcs";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";

import type { UpdateTransition } from "./updateTransitions.ts";

export class AgentUpdates extends Context.Service<
  AgentUpdates,
  {
    readonly targetVersion: string;
    readonly updates: SubscriptionRef.SubscriptionRef<ReadonlyMap<MachineId, AgentUpdate>>;
    readonly start: (
      machineId: MachineId,
    ) => Effect.Effect<void, MachineNotFound | AgentNotUpdatable>;
    readonly fail: (failure: {
      readonly machineId: MachineId;
      readonly version: string;
      readonly message: string;
    }) => Effect.Effect<void>;
    readonly connected: (agent: {
      readonly machineId: MachineId;
      readonly agentVersion: string;
    }) => Effect.Effect<void>;
  }
>()("fleetfrog/AgentUpdates") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const sessions = yield* AgentSessions;
      const machines = yield* MachineStore;
      const targetVersion = packageJson.version;
      const updates = yield* SubscriptionRef.make<ReadonlyMap<MachineId, AgentUpdate>>(new Map());

      const transition = (
        machineId: MachineId,
        decide: (update: AgentUpdate | undefined) => UpdateTransition<AgentUpdate>,
      ) => transitionUpdate(updates, machineId, decide);

      return {
        targetVersion,
        updates,
        start: Effect.fn("AgentUpdates.start")(function* (machineId) {
          const record = yield* machines.find(machineId);
          const agent = (yield* SubscriptionRef.get(sessions.online)).get(machineId);
          const since = yield* DateTime.now;
          const claim = AgentUpdate.cases.Updating.make({ version: targetVersion, since });

          const connection =
            agent === undefined
              ? Connection.cases.Offline.make({ lastSeenAt: record.lastSeenAt })
              : Connection.cases.Online.make({
                  since: agent.since,
                  capabilities: agent.capabilities,
                });

          const requestUpdate = Effect.gen(function* () {
            const claimed = yield* SubscriptionRef.modifySome(updates, (current) => {
              const machine = {
                info: record.info,
                connection,
                update: current.get(machineId) ?? null,
              };

              return canUpdateAgent(machine, targetVersion)
                ? [true, Option.some(withUpdate(current, machineId, claim))]
                : [false, Option.none()];
            });

            if (!claimed) {
              return false;
            }

            const sent = yield* sessions.send(
              machineId,
              HubCommand.cases.Update.make({ version: targetVersion }),
            );

            if (sent === null) {
              yield* transition(machineId, (update) => (update === claim ? clear : keep));
            }

            return sent !== null;
          });

          if (!(yield* requestUpdate.pipe(Effect.uninterruptible))) {
            return yield* new AgentNotUpdatable({ machineId });
          }

          return yield* Effect.logInfo(`Asked the agent to update to ${targetVersion}`).pipe(
            Effect.annotateLogs({ machineId }),
          );
        }),
        fail: Effect.fn("AgentUpdates.fail")(({ machineId, version, message }) =>
          Effect.logWarning(`The agent couldn't update to ${version}: ${message}`).pipe(
            Effect.annotateLogs({ machineId }),
            Effect.andThen(
              transition(machineId, (update) =>
                update?._tag === "Failed" &&
                update.version === version &&
                update.message === message
                  ? keep
                  : set(AgentUpdate.cases.Failed.make({ version, message })),
              ),
            ),
          ),
        ),
        connected: Effect.fn("AgentUpdates.connected")(({ machineId, agentVersion }) =>
          transition(machineId, (update) => {
            if (update === undefined) {
              return keep;
            }

            if (compareVersions(agentVersion, update.version) >= 0) {
              return clear;
            }

            return update._tag === "Updating"
              ? set(
                  AgentUpdate.cases.Failed.make({
                    version: update.version,
                    message: `The agent reconnected on ${agentVersion} before the update finished.`,
                  }),
                )
              : keep;
          }),
        ),
      };
    }),
  );
}
