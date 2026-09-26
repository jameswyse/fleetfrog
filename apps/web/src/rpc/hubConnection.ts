import { useSyncExternalStore } from "react";

import { Cause, DateTime, Deferred, Duration, Effect, Layer, Result, Stream } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";

import { DashboardRpcs } from "@fleetfrog/protocol/dashboard/rpcs";

import type { RpcClientError } from "effect/unstable/rpc";

import type { MachineNotFound } from "@fleetfrog/protocol/dashboard/rpcs";
import type { Fleet } from "@fleetfrog/protocol/domain/fleet";

type DashboardClient = RpcClient.FromGroup<typeof DashboardRpcs, RpcClientError.RpcClientError>;

/** Every typed failure a dashboard call can report. */
type DashboardError = MachineNotFound | RpcClientError.RpcClientError;

/** The most recent fleet from the hub and when the dashboard received it. */
export type FleetSnapshot = { readonly fleet: Fleet; readonly receivedAt: DateTime.Utc };

export type HubState =
  | { readonly _tag: "Connecting" }
  | { readonly _tag: "Live"; readonly snapshot: FleetSnapshot }
  /** The last snapshot stays visible, marked stale, while the dashboard reconnects. */
  | { readonly _tag: "Reconnecting"; readonly snapshot: FleetSnapshot | null };

const retryDelay = Duration.seconds(2);

let state: HubState = { _tag: "Connecting" };
let client: DashboardClient | null = null;
const listeners = new Set<() => void>();

function setState(next: HubState): void {
  state = next;

  for (const listener of listeners) {
    listener();
  }
}

/** The fleet to show, which may be stale while reconnecting, or null before the first one arrives. */
export function knownFleet(hub: HubState): Fleet | null {
  return hub._tag === "Connecting" ? null : (hub.snapshot?.fleet ?? null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function useHub(): HubState {
  return useSyncExternalStore(subscribe, () => state);
}

/** One connection: follows the fleet until the socket drops, which ends it so a fresh one can start. */
const session = Effect.gen(function* () {
  const dropped = yield* Deferred.make<void>();
  const url = new URL("/rpc", window.location.href);

  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

  const context = yield* Layer.build(
    RpcClient.layerProtocolSocket().pipe(
      Layer.provide(Socket.layerWebSocket(url.href)),
      Layer.provide([
        Socket.layerWebSocketConstructorGlobal,
        RpcSerialization.layerJson,
        Layer.succeed(RpcClient.ConnectionHooks)({
          onConnect: Effect.void,
          onDisconnect: Deferred.succeed(dropped, undefined).pipe(Effect.asVoid),
        }),
      ]),
    ),
  );
  const connected = yield* RpcClient.make(DashboardRpcs).pipe(Effect.provideContext(context));

  client = connected;
  yield* connected.WatchFleet().pipe(
    Stream.runForEach((fleet) =>
      DateTime.now.pipe(
        Effect.map((receivedAt) => setState({ _tag: "Live", snapshot: { fleet, receivedAt } })),
      ),
    ),
    Effect.raceFirst(Deferred.await(dropped)),
  );
}).pipe(
  Effect.scoped,
  Effect.ensuring(
    Effect.sync(() => {
      client = null;
      setState({
        _tag: "Reconnecting",
        snapshot: state._tag === "Connecting" ? null : state.snapshot,
      });
    }),
  ),
);

/** Connects to the hub for the lifetime of the page, reconnecting after any drop. */
export function startHubConnection(): void {
  Effect.runFork(
    session.pipe(
      Effect.catchCause((cause) => Effect.logWarning("Hub connection lost", cause)),
      Effect.andThen(Effect.sleep(retryDelay)),
      Effect.forever,
    ),
  );
}

export type HubResult<A> =
  | { readonly _tag: "Success"; readonly value: A }
  | { readonly _tag: "Failure"; readonly message: string };

const unreachable = "Can't reach the hub right now. Try again once it reconnects.";

const failureMessages = {
  MachineNotFound: "That machine is no longer paired.",
  RpcClientError: "The hub did not respond. Check that it is still running.",
} satisfies Record<DashboardError["_tag"], string>;

function describeCause(cause: Cause.Cause<DashboardError>): string {
  const error = Cause.findError(cause);

  return Result.isSuccess(error)
    ? failureMessages[error.success._tag]
    : "Something went wrong talking to the hub. Try again.";
}

/**
 * Runs one dashboard call and turns any failure, including defects and interruptions, into a
 * sentence for the interface. The promise never rejects.
 */
export function requestHub<A>(
  call: (hub: DashboardClient) => Effect.Effect<A, DashboardError>,
): Promise<HubResult<A>> {
  if (client === null) {
    return Promise.resolve({ _tag: "Failure", message: unreachable });
  }

  return Effect.runPromise(
    call(client).pipe(
      Effect.matchCauseEffect({
        onSuccess: (value) => Effect.succeed<HubResult<A>>({ _tag: "Success", value }),
        onFailure: (cause) =>
          Effect.logWarning("Hub request failed", cause).pipe(
            Effect.as<HubResult<A>>({ _tag: "Failure", message: describeCause(cause) }),
          ),
      }),
    ),
  );
}
