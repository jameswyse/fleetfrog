import {
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Schedule,
  SubscriptionRef,
} from "effect";

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
import { clear, keep, set, transitionUpdate, withUpdate } from "../agents/updateTransitions.ts";
import { MachineStore } from "../machines/machineStore.ts";
import { IntegrationsStore } from "../settings/integrationsStore.ts";
import { T3CodeReleaseFeed } from "./t3CodeReleaseFeed.ts";

import type { MachineNotFound } from "@fleetfrog/protocol/dashboard/rpcs";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";
import type { T3CodeStatus } from "@fleetfrog/protocol/domain/t3Code";
import type { T3CodeUpdateOutcome } from "@fleetfrog/protocol/domain/t3CodeUpdate";

import type { UpdateTransition } from "../agents/updateTransitions.ts";

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

      const transition = (
        machineId: MachineId,
        decide: (update: T3CodeUpdate | undefined) => UpdateTransition<T3CodeUpdate>,
      ) => transitionUpdate(updates, machineId, decide);

      const expire = Effect.gen(function* () {
        const now = yield* DateTime.now;

        yield* SubscriptionRef.updateSome(updates, (current) => {
          const expired = [...current].filter(
            ([, update]) =>
              update._tag === "Updating" &&
              DateTime.isGreaterThanOrEqualTo(
                now,
                DateTime.addDuration(update.since, t3CodeUpdateLimit),
              ),
          );

          if (expired.length === 0) {
            return Option.none();
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

          return Option.some(next);
        });
      });

      yield* expire.pipe(Effect.repeat(Schedule.spaced(Duration.minutes(1))), Effect.forkScoped);

      return {
        updates,
        start: Effect.fn("T3CodeUpdates.start")(function* (machineId) {
          const record = yield* machines.find(machineId);
          const agent = (yield* SubscriptionRef.get(sessions.online)).get(machineId);
          const releases = yield* SubscriptionRef.get(releaseFeed.releases);
          const { t3Code: settings } = yield* SubscriptionRef.get(integrations.settings);
          const since = yield* DateTime.now;
          const version = availableT3CodeVersion(record.t3Code, releases);

          if (!settings.enabled || version === null) {
            return yield* new T3CodeNotUpdatable({ machineId });
          }

          const claim = T3CodeUpdate.cases.Updating.make({ version, since });

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
                connection,
                t3Code: record.t3Code,
                t3CodeUpdate: current.get(machineId) ?? null,
              };

              return canUpdateT3Code(machine, releases)
                ? [true, Option.some(withUpdate(current, machineId, claim))]
                : [false, Option.none()];
            });

            if (!claimed) {
              return false;
            }

            const sent = yield* sessions.send(
              machineId,
              HubCommand.cases.UpdateT3Code.make({ version }),
            );

            if (sent === null) {
              yield* transition(machineId, (update) => (update === claim ? clear : keep));
            }

            return sent !== null;
          });

          if (!(yield* requestUpdate.pipe(Effect.uninterruptible))) {
            return yield* new T3CodeNotUpdatable({ machineId });
          }

          return yield* Effect.logInfo(`Asked the agent to update T3 Code to ${version}`).pipe(
            Effect.annotateLogs({ machineId }),
          );
        }),
        finish: Effect.fn("T3CodeUpdates.finish")(function* ({ machineId, version, outcome }) {
          if (outcome._tag !== "Updated") {
            yield* Effect.logWarning(
              `T3 Code couldn't update to ${version}: ${outcome.message}`,
            ).pipe(Effect.annotateLogs({ machineId }));

            yield* transition(machineId, (update) =>
              update?._tag === "Failed" &&
              update.version === version &&
              update.message === outcome.message
                ? keep
                : set(T3CodeUpdate.cases.Failed.make({ version, message: outcome.message })),
            );

            return;
          }

          yield* Effect.logInfo(`The agent installed T3 Code ${version}`).pipe(
            Effect.annotateLogs({ machineId }),
          );

          const now = yield* DateTime.now;
          const machine = yield* machines.find(machineId).pipe(Effect.option);

          yield* transition(machineId, (update) => {
            if (update === undefined) {
              return keep;
            }

            if (Option.isNone(machine)) {
              return clear;
            }

            const running = machine.value.t3Code?.server?.version ?? null;

            if (running !== null && !isNewerT3Code(version, running)) {
              return clear;
            }

            if (update._tag === "Updating" && update.version === version) {
              return keep;
            }

            return set(
              T3CodeUpdate.cases.Updating.make({
                version,
                since: update._tag === "Updating" ? update.since : now,
              }),
            );
          });
        }),
        reported: Effect.fn("T3CodeUpdates.reported")(({ machineId, status }) =>
          transition(machineId, (update) => {
            const server = status.server;

            if (update === undefined || server === null || server.version === null) {
              return keep;
            }

            if (!isNewerT3Code(update.version, server.version)) {
              return clear;
            }

            return update._tag === "Updating" &&
              DateTime.isGreaterThan(server.startedAt, update.since)
              ? set(
                  T3CodeUpdate.cases.Failed.make({
                    version: update.version,
                    message: `T3 Code restarted on ${server.version} instead.`,
                  }),
                )
              : keep;
          }),
        ),
        connected: Effect.fn("T3CodeUpdates.connected")((machineId) =>
          transition(machineId, (update) =>
            update?._tag === "Updating"
              ? set(
                  T3CodeUpdate.cases.Failed.make({
                    version: update.version,
                    message: "The agent reconnected before T3 Code's update finished.",
                  }),
                )
              : keep,
          ),
        ),
      };
    }),
  );
}
