import { randomUUID } from "node:crypto";

import { Context, DateTime, Duration, Effect, Layer, Queue, Stream, SubscriptionRef } from "effect";

import {
  HubCommand,
  heartbeatSeconds,
  heartbeatTimeoutSeconds,
} from "@fleetfrog/protocol/agent/rpcs";

import { DashboardPresence } from "../dashboard/dashboardPresence.ts";
import { MachineStore } from "../machines/machineStore.ts";
import { PollingStore } from "../settings/pollingStore.ts";

import type { Cause, Scope } from "effect";

import type { AgentCapabilities } from "@fleetfrog/protocol/domain/action";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";

/** A connected agent as the rest of the hub sees it. */
export interface OnlineAgent {
  readonly since: DateTime.Utc;
  /** Distinguishes a reconnection, which abandons the previous connection's actions. */
  readonly sessionId: string;
  readonly capabilities: AgentCapabilities;
}

interface Session {
  readonly id: string;
  readonly since: DateTime.Utc;
  capabilities: AgentCapabilities;
  readonly commands: Queue.Queue<HubCommand, Cause.Done>;
  /** Epoch milliseconds of the last heartbeat, or of connecting. */
  lastHeartbeatAt: number;
}

/** Connected agents and the command stream each one holds open. */
export class AgentSessions extends Context.Service<
  AgentSessions,
  {
    readonly online: SubscriptionRef.SubscriptionRef<ReadonlyMap<MachineId, OnlineAgent>>;
    /**
     * Registers an agent connection until the scope closes and returns its commands, starting with
     * its configuration. A newer connection from the same machine ends the older one.
     */
    readonly connect: (connection: {
      readonly machineId: MachineId;
      readonly capabilities: AgentCapabilities;
    }) => Effect.Effect<Stream.Stream<HubCommand>, never, Scope.Scope>;
    /** Records capabilities the agent advertised after its owner changed its policy. */
    readonly advertise: (agent: {
      readonly machineId: MachineId;
      readonly capabilities: AgentCapabilities;
    }) => Effect.Effect<void>;
    /** Queues a command for a connected agent. Returns its session, or null when it is offline. */
    readonly send: (machineId: MachineId, command: HubCommand) => Effect.Effect<string | null>;
    /** Resends a machine's configuration after its discovery roots change. */
    readonly reconfigure: (machineId: MachineId) => Effect.Effect<void>;
    readonly heartbeat: (machineId: MachineId) => Effect.Effect<void>;
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
      const online = yield* SubscriptionRef.make<ReadonlyMap<MachineId, OnlineAgent>>(new Map());

      const publishOnline = Effect.suspend(() =>
        SubscriptionRef.set(
          online,
          new Map(
            [...sessions].map(([machineId, session]) => [
              machineId,
              { since: session.since, sessionId: session.id, capabilities: session.capabilities },
            ]),
          ),
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

      const disconnect = (machineId: MachineId) => {
        const session = sessions.get(machineId);

        if (session === undefined) {
          return Effect.void;
        }

        sessions.delete(machineId);

        return Queue.end(session.commands).pipe(Effect.andThen(publishOnline));
      };

      const reconfigure = (machineId: MachineId) => {
        const session = sessions.get(machineId);

        return session === undefined
          ? Effect.void
          : configuration(machineId).pipe(
              Effect.flatMap((command) => Queue.offer(session.commands, command)),
              // A machine removed while connecting has nothing to do. Ending its stream makes the
              // agent reconnect, and its revoked token then stops it.
              Effect.catchTag("MachineNotFound", () => disconnect(machineId)),
              Effect.asVoid,
            );
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

      // A sleeping or unplugged machine never closes its socket, so silence ends the session.
      yield* Effect.gen(function* () {
        const cutoff = Date.now() - heartbeatTimeoutSeconds * 1000;

        for (const [machineId, session] of sessions) {
          if (session.lastHeartbeatAt < cutoff) {
            yield* Effect.logInfo("Agent stopped responding").pipe(
              Effect.annotateLogs({ machineId }),
            );
            yield* disconnect(machineId);
            yield* machines.recordSeen(machineId);
          }
        }
      }).pipe(Effect.delay(Duration.seconds(heartbeatSeconds)), Effect.forever, Effect.forkScoped);

      return {
        online,
        connect: ({ machineId, capabilities }) =>
          Effect.gen(function* () {
            // Registration and its release are one step, so no interruption can leave a session
            // registered without the finaliser that removes it.
            const session = yield* Effect.acquireRelease(
              Effect.gen(function* () {
                yield* disconnect(machineId);

                const since = yield* DateTime.now;
                const registered: Session = {
                  id: randomUUID(),
                  since,
                  capabilities,
                  commands: yield* Queue.unbounded<HubCommand, Cause.Done>(),
                  lastHeartbeatAt: DateTime.toEpochMillis(since),
                };

                sessions.set(machineId, registered);

                return registered;
              }),
              (registered) =>
                sessions.get(machineId) === registered
                  ? disconnect(machineId).pipe(Effect.andThen(machines.recordSeen(machineId)))
                  : Queue.end(registered.commands).pipe(Effect.asVoid),
            );

            yield* publishOnline;
            yield* reconfigure(machineId);

            return Stream.fromQueue(session.commands);
          }),
        reconfigure,
        advertise: ({ machineId, capabilities }) =>
          Effect.suspend(() => {
            const session = sessions.get(machineId);

            if (session === undefined) {
              return Effect.void;
            }

            session.capabilities = capabilities;

            return publishOnline;
          }),
        send: (machineId, command) =>
          Effect.suspend(() => {
            const session = sessions.get(machineId);

            return session === undefined
              ? Effect.succeed(null)
              : Queue.offer(session.commands, command).pipe(
                  Effect.map((offered) => (offered ? session.id : null)),
                );
          }),
        heartbeat: (machineId) =>
          Effect.sync(() => {
            const session = sessions.get(machineId);

            if (session !== undefined) {
              session.lastHeartbeatAt = Date.now();
            }
          }),
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
