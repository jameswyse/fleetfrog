import { useSyncExternalStore } from "react";

import { Deferred, Duration, Effect, Layer, Stream } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";

import { DashboardRpcs } from "@fleetfrog/protocol/dashboard/rpcs";

import type { RpcClientError } from "effect/unstable/rpc";

import type { Fleet } from "@fleetfrog/protocol/domain/fleet";

type DashboardClient = RpcClient.FromGroup<typeof DashboardRpcs, RpcClientError.RpcClientError>;

export type HubState =
  | { readonly _tag: "Connecting" }
  | { readonly _tag: "Live"; readonly fleet: Fleet }
  /** The last fleet received stays visible, marked stale, while the dashboard reconnects. */
  | { readonly _tag: "Reconnecting"; readonly fleet: Fleet | null };

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

function lastFleet(): Fleet | null {
  return state._tag === "Connecting" ? null : state.fleet;
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
    Stream.runForEach((fleet) => Effect.sync(() => setState({ _tag: "Live", fleet }))),
    Effect.raceFirst(Deferred.await(dropped)),
  );
}).pipe(
  Effect.scoped,
  Effect.ensuring(
    Effect.sync(() => {
      client = null;
      setState({ _tag: "Reconnecting", fleet: lastFleet() });
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

function describeFailure(error: { readonly _tag: string }): string {
  switch (error._tag) {
    case "MachineNotFound":
      return "That machine is no longer paired.";
    default:
      return "The hub did not respond. Check that it is still running.";
  }
}

/** Runs one dashboard call and turns any failure into a sentence for the interface. */
export function requestHub<A, E extends { readonly _tag: string }>(
  call: (hub: DashboardClient) => Effect.Effect<A, E>,
): Promise<HubResult<A>> {
  if (client === null) {
    return Promise.resolve({ _tag: "Failure", message: "Not connected to the hub yet." });
  }

  return Effect.runPromise(
    call(client).pipe(
      Effect.map((value): HubResult<A> => ({ _tag: "Success", value })),
      Effect.catch((error) =>
        Effect.succeed<HubResult<A>>({ _tag: "Failure", message: describeFailure(error) }),
      ),
    ),
  );
}
