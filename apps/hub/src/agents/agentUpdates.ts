import { Context, DateTime, Effect, Layer, SubscriptionRef } from "effect";

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

import type { MachineNotFound } from "@fleetfrog/protocol/dashboard/rpcs";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";

/**
 * Updates agents to the hub's own version, which every FleetFrog package shares, so an agent never
 * runs a version its hub doesn't know. Tracks each update until the agent reconnects.
 */
export class AgentUpdates extends Context.Service<
  AgentUpdates,
  {
    /** The version agents should run: the hub's own. */
    readonly targetVersion: string;
    readonly updates: SubscriptionRef.SubscriptionRef<ReadonlyMap<MachineId, AgentUpdate>>;
    /** Asks the machine's agent to update to the target version. */
    readonly start: (
      machineId: MachineId,
    ) => Effect.Effect<void, MachineNotFound | AgentNotUpdatable>;
    /** Records the agent's answer that it couldn't update. */
    readonly fail: (failure: {
      readonly machineId: MachineId;
      readonly version: string;
      readonly message: string;
    }) => Effect.Effect<void>;
    /**
     * Settles an update when its agent reconnects: done if it runs the new version, and failed if
     * it came back on its old one, which means it stopped before installing.
     */
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

      const settle = (machineId: MachineId, update: AgentUpdate | null) =>
        SubscriptionRef.update(updates, (current) => {
          const next = new Map(current);

          if (update === null) {
            next.delete(machineId);
          } else {
            next.set(machineId, update);
          }

          return next;
        });

      return {
        targetVersion,
        updates,
        start: Effect.fn("AgentUpdates.start")(function* (machineId) {
          const record = yield* machines.find(machineId);
          const agent = (yield* SubscriptionRef.get(sessions.online)).get(machineId);
          const since = yield* DateTime.now;
          const connection =
            agent === undefined
              ? Connection.cases.Offline.make({ lastSeenAt: record.lastSeenAt })
              : Connection.cases.Online.make({
                  since: agent.since,
                  capabilities: agent.capabilities,
                });
          // Checked and claimed in one step, so a second click can't send the command twice.
          const claimed = yield* SubscriptionRef.modify(updates, (current) => {
            const machine = {
              info: record.info,
              connection,
              update: current.get(machineId) ?? null,
            };

            if (!canUpdateAgent(machine, targetVersion)) {
              return [false, current];
            }

            return [
              true,
              new Map(current).set(
                machineId,
                AgentUpdate.cases.Updating.make({ version: targetVersion, since }),
              ),
            ];
          });

          if (!claimed) {
            return yield* new AgentNotUpdatable({ machineId });
          }

          const sent = yield* sessions.send(
            machineId,
            HubCommand.cases.Update.make({ version: targetVersion }),
          );

          if (sent === null) {
            yield* settle(machineId, null);

            return yield* new AgentNotUpdatable({ machineId });
          }

          return yield* Effect.logInfo(`Asked the agent to update to ${targetVersion}`).pipe(
            Effect.annotateLogs({ machineId }),
          );
        }),
        fail: ({ machineId, version, message }) =>
          Effect.logWarning(`The agent couldn't update to ${version}: ${message}`).pipe(
            Effect.annotateLogs({ machineId }),
            Effect.andThen(settle(machineId, AgentUpdate.cases.Failed.make({ version, message }))),
          ),
        connected: ({ machineId, agentVersion }) =>
          Effect.gen(function* () {
            const update = (yield* SubscriptionRef.get(updates)).get(machineId);

            if (update === undefined) {
              return;
            }

            if (compareVersions(agentVersion, update.version) >= 0) {
              yield* settle(machineId, null);
            } else if (update._tag === "Updating") {
              yield* settle(
                machineId,
                AgentUpdate.cases.Failed.make({
                  version: update.version,
                  message: `The agent reconnected on ${agentVersion} before the update finished.`,
                }),
              );
            }
          }),
      };
    }),
  );
}
