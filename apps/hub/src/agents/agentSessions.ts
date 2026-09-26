import { Context, DateTime, Effect, Layer, Queue, Stream, SubscriptionRef } from "effect";

import { HubCommand } from "@fleetfrog/protocol/agent/rpcs";

import { DashboardPresence } from "../dashboard/dashboardPresence.ts";
import { MachineStore } from "../machines/machineStore.ts";
import { PollingStore } from "../settings/pollingStore.ts";

import type { Cause, Scope } from "effect";

import type { MachineId } from "@fleetfrog/protocol/domain/machine";

interface Session {
  readonly since: DateTime.Utc;
  readonly commands: Queue.Queue<HubCommand, Cause.Done>;
}

/** Connected agents and the command stream each one holds open. */
export class AgentSessions extends Context.Service<
  AgentSessions,
  {
    /** When each connected machine came online. */
    readonly online: SubscriptionRef.SubscriptionRef<ReadonlyMap<MachineId, DateTime.Utc>>;
    /**
     * Registers an agent connection until the scope closes and returns its commands, starting with
     * its configuration. A newer connection from the same machine ends the older one.
     */
    readonly connect: (
      machineId: MachineId,
    ) => Effect.Effect<Stream.Stream<HubCommand>, never, Scope.Scope>;
    /** Resends a machine's configuration after its discovery roots change. */
    readonly reconfigure: (machineId: MachineId) => Effect.Effect<void>;
    readonly refresh: (machineIds: ReadonlyArray<MachineId> | "all") => Effect.Effect<void>;
    readonly disconnect: (machineId: MachineId) => Effect.Effect<void>;
  }
>()("fleetfrog/AgentSessions") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const machines = yield* MachineStore;
      const polling = yield* PollingStore;
      const presence = yield* DashboardPresence;
      const sessions = new Map<MachineId, Session>();
      const online = yield* SubscriptionRef.make<ReadonlyMap<MachineId, DateTime.Utc>>(new Map());

      const publishOnline = Effect.suspend(() =>
        SubscriptionRef.set(
          online,
          new Map([...sessions].map(([machineId, session]) => [machineId, session.since])),
        ),
      );

      const configuration = Effect.fn("AgentSessions.configuration")(function* (
        machineId: MachineId,
      ) {
        const machine = yield* machines.find(machineId);
        const settings = yield* SubscriptionRef.get(polling.settings);
        const watching = (yield* SubscriptionRef.get(presence.watchers)) > 0;

        return HubCommand.cases.Configure.make({
          discoveryRoots: machine.discoveryRoots,
          schedule: {
            statusSeconds: watching ? settings.watchingStatusSeconds : settings.idleStatusSeconds,
            discoverySeconds: settings.discoverySeconds,
            githubSeconds: settings.githubSeconds,
          },
        });
      });

      const reconfigure = (machineId: MachineId) => {
        const session = sessions.get(machineId);

        return session === undefined
          ? Effect.void
          : configuration(machineId).pipe(
              Effect.flatMap((command) => Queue.offer(session.commands, command)),
              // A machine removed while connected has no configuration left to send.
              Effect.catchTag("MachineNotFound", () => Effect.void),
              Effect.asVoid,
            );
      };

      const disconnect = (machineId: MachineId) => {
        const session = sessions.get(machineId);

        if (session === undefined) {
          return Effect.void;
        }

        sessions.delete(machineId);

        return Queue.end(session.commands).pipe(Effect.andThen(publishOnline));
      };

      // Polling changes and dashboards opening or closing change every agent's schedule.
      // The initial values arrive before any agent connects, so they reconfigure nobody.
      yield* Stream.merge(
        SubscriptionRef.changes(polling.settings),
        SubscriptionRef.changes(presence.watchers).pipe(
          Stream.map((count) => count > 0),
          Stream.changes,
        ),
      ).pipe(
        Stream.runForEach(() =>
          Effect.forEach([...sessions.keys()], reconfigure, { discard: true }),
        ),
        Effect.forkScoped,
      );

      return {
        online,
        connect: (machineId) =>
          Effect.gen(function* () {
            yield* disconnect(machineId);

            const session: Session = {
              since: yield* DateTime.now,
              commands: yield* Queue.unbounded<HubCommand, Cause.Done>(),
            };

            sessions.set(machineId, session);
            yield* publishOnline;
            yield* reconfigure(machineId);
            yield* Effect.addFinalizer(() =>
              sessions.get(machineId) === session
                ? disconnect(machineId).pipe(Effect.andThen(machines.recordSeen(machineId)))
                : Effect.void,
            );

            return Stream.fromQueue(session.commands);
          }),
        reconfigure,
        refresh: (machineIds) =>
          Effect.forEach(
            machineIds === "all"
              ? [...sessions.values()]
              : machineIds.flatMap((id) => sessions.get(id) ?? []),
            (session) => Queue.offer(session.commands, HubCommand.cases.Refresh.make({})),
            { discard: true },
          ),
        disconnect,
      };
    }),
  );
}
