import { Context, DateTime, Duration, Effect, Layer, SubscriptionRef } from "effect";

import { HubCommand } from "@fleetfrog/protocol/agent/rpcs";
import { T3CodeNotUpdatable } from "@fleetfrog/protocol/dashboard/rpcs";
import { Connection } from "@fleetfrog/protocol/domain/fleet";
import {
  availableT3CodeVersion,
  canUpdateT3Code,
  isNewerT3Code,
  T3CodeUpdate,
} from "@fleetfrog/protocol/domain/t3CodeUpdate";

import { AgentSessions } from "../agents/agentSessions.ts";
import { MachineStore } from "../machines/machineStore.ts";
import { IntegrationsStore } from "../settings/integrationsStore.ts";
import { T3CodeReleaseFeed } from "./t3CodeReleaseFeed.ts";

import type { MachineNotFound } from "@fleetfrog/protocol/dashboard/rpcs";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";
import type { T3CodeStatus } from "@fleetfrog/protocol/domain/t3Code";
import type { T3CodeUpdateOutcome } from "@fleetfrog/protocol/domain/t3CodeUpdate";

export const t3CodeUpdateLimit = Duration.minutes(35);

export class T3CodeUpdates extends Context.Service<
  T3CodeUpdates,
  {
    readonly updates: SubscriptionRef.SubscriptionRef<ReadonlyMap<MachineId, T3CodeUpdate>>;
    readonly start: (
      machineId: MachineId,
    ) => Effect.Effect<void, MachineNotFound | T3CodeNotUpdatable>;
    readonly finish: (report: {
      readonly machineId: MachineId;
      readonly version: string;
      readonly outcome: T3CodeUpdateOutcome;
    }) => Effect.Effect<void>;
    readonly reported: (report: {
      readonly machineId: MachineId;
      readonly status: T3CodeStatus;
    }) => Effect.Effect<void>;
    readonly connected: (machineId: MachineId) => Effect.Effect<void>;
  }
>()("fleetfrog/T3CodeUpdates") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const sessions = yield* AgentSessions;
      const machines = yield* MachineStore;
      const integrations = yield* IntegrationsStore;
      const releaseFeed = yield* T3CodeReleaseFeed;
      const updates = yield* SubscriptionRef.make<ReadonlyMap<MachineId, T3CodeUpdate>>(new Map());

      const settle = (machineId: MachineId, update: T3CodeUpdate | null) =>
        SubscriptionRef.update(updates, (current) => {
          const next = new Map(current);

          if (update === null) {
            next.delete(machineId);
          } else {
            next.set(machineId, update);
          }

          return next;
        });

      const expire = Effect.gen(function* () {
        const now = yield* DateTime.now;

        yield* SubscriptionRef.update(updates, (current) => {
          const expired = [...current].filter(
            ([, update]) =>
              update._tag === "Updating" &&
              DateTime.isGreaterThanOrEqualTo(
                now,
                DateTime.addDuration(update.since, t3CodeUpdateLimit),
              ),
          );

          if (expired.length === 0) {
            return current;
          }

          const next = new Map(current);

          for (const [machineId, update] of expired) {
            next.set(
              machineId,
              T3CodeUpdate.cases.Failed.make({
                version: update.version,
                message: "T3 Code didn't report the new version within 35 minutes.",
              }),
            );
          }

          return next;
        });
      });

      yield* expire.pipe(
        Effect.andThen(Effect.sleep(Duration.minutes(1))),
        Effect.forever,
        Effect.forkScoped,
      );

      return {
        updates,
        start: Effect.fn("T3CodeUpdates.start")(function* (machineId) {
          const record = yield* machines.find(machineId);
          const agent = (yield* SubscriptionRef.get(sessions.online)).get(machineId);
          const releases = yield* SubscriptionRef.get(releaseFeed.releases);
          const { t3Code: settings } = yield* SubscriptionRef.get(integrations.settings);
          const since = yield* DateTime.now;
          const version = availableT3CodeVersion(record.t3Code, releases);

          const connection =
            agent === undefined
              ? Connection.cases.Offline.make({ lastSeenAt: record.lastSeenAt })
              : Connection.cases.Online.make({
                  since: agent.since,
                  capabilities: agent.capabilities,
                });

          const claimed = yield* SubscriptionRef.modify(updates, (current) => {
            const machine = {
              connection,
              t3Code: record.t3Code,
              t3CodeUpdate: current.get(machineId) ?? null,
            };

            if (!settings.enabled || version === null || !canUpdateT3Code(machine, releases)) {
              return [false, current];
            }

            return [
              true,
              new Map(current).set(machineId, T3CodeUpdate.cases.Updating.make({ version, since })),
            ];
          });

          if (!claimed || version === null) {
            return yield* new T3CodeNotUpdatable({ machineId });
          }

          const sent = yield* sessions.send(
            machineId,
            HubCommand.cases.UpdateT3Code.make({ version }),
          );

          if (sent === null) {
            yield* settle(machineId, null);

            return yield* new T3CodeNotUpdatable({ machineId });
          }

          return yield* Effect.logInfo(`Asked the agent to update T3 Code to ${version}`).pipe(
            Effect.annotateLogs({ machineId }),
          );
        }),
        finish: ({ machineId, version, outcome }) =>
          outcome._tag === "Updated"
            ? Effect.gen(function* () {
                yield* Effect.logInfo(`The agent installed T3 Code ${version}`).pipe(
                  Effect.annotateLogs({ machineId }),
                );

                const now = yield* DateTime.now;

                const running = yield* machines.find(machineId).pipe(
                  Effect.map((record) => record.t3Code?.server?.version ?? null),
                  Effect.catchTag("MachineNotFound", () => Effect.succeed(null)),
                );

                yield* SubscriptionRef.update(updates, (current) => {
                  const update = current.get(machineId);

                  if (update === undefined) {
                    return current;
                  }

                  const next = new Map(current);

                  if (running !== null && !isNewerT3Code(version, running)) {
                    next.delete(machineId);
                  } else {
                    next.set(
                      machineId,
                      T3CodeUpdate.cases.Updating.make({
                        version,
                        since: update._tag === "Updating" ? update.since : now,
                      }),
                    );
                  }

                  return next;
                });
              })
            : Effect.logWarning(`T3 Code couldn't update to ${version}: ${outcome.message}`).pipe(
                Effect.annotateLogs({ machineId }),
                Effect.andThen(
                  settle(
                    machineId,
                    T3CodeUpdate.cases.Failed.make({ version, message: outcome.message }),
                  ),
                ),
              ),
        reported: ({ machineId, status }) =>
          Effect.gen(function* () {
            const update = (yield* SubscriptionRef.get(updates)).get(machineId);
            const server = status.server;

            if (update === undefined || server === null || server.version === null) {
              return;
            }

            if (!isNewerT3Code(update.version, server.version)) {
              yield* settle(machineId, null);
            } else if (
              update._tag === "Updating" &&
              DateTime.isGreaterThan(server.startedAt, update.since)
            ) {
              yield* settle(
                machineId,
                T3CodeUpdate.cases.Failed.make({
                  version: update.version,
                  message: `T3 Code restarted on ${server.version} instead.`,
                }),
              );
            }
          }),
        connected: (machineId) =>
          Effect.gen(function* () {
            const update = (yield* SubscriptionRef.get(updates)).get(machineId);

            if (update?._tag === "Updating") {
              yield* settle(
                machineId,
                T3CodeUpdate.cases.Failed.make({
                  version: update.version,
                  message: "The agent reconnected before T3 Code's update finished.",
                }),
              );
            }
          }),
      };
    }),
  );
}
