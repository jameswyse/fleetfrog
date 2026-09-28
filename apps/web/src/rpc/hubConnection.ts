import { useSyncExternalStore } from "react";

import {
  Cause,
  DateTime,
  Deferred,
  Duration,
  Effect,
  Layer,
  Predicate,
  Result,
  Stream,
} from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";

import { DashboardRpcs } from "@fleetfrog/protocol/dashboard/rpcs";

import { refreshSession, whenAccessible } from "./session.ts";

import type { RpcClientError } from "effect/rpc";

import type {
  AgentNotUpdatable,
  BatchNotFound,
  EmailTaken,
  Forbidden,
  InvalidArchiveFolder,
  InvalidAvatar,
  InvalidIcon,
  LastAdmin,
  MachineNotFound,
  ManagedByProvider,
  NoCloneSource,
  NothingToRun,
  NotSignedIn,
  ProviderRejected,
  RepositoryNotFound,
  TailscaleServeUnavailable,
  TooManyAttempts,
  UserNotFound,
  WrongPassword,
} from "@fleetfrog/protocol/dashboard/rpcs";
import type { RunsSnapshot } from "@fleetfrog/protocol/domain/activity";
import type { Fleet } from "@fleetfrog/protocol/domain/fleet";

export type DashboardClient = RpcClient.FromGroup<
  typeof DashboardRpcs,
  RpcClientError.RpcClientError
>;

/** Every typed failure a dashboard call can report. */
export type DashboardError =
  | MachineNotFound
  | RepositoryNotFound
  | NothingToRun
  | NoCloneSource
  | BatchNotFound
  | InvalidArchiveFolder
  | AgentNotUpdatable
  | NotSignedIn
  | Forbidden
  | UserNotFound
  | EmailTaken
  | LastAdmin
  | WrongPassword
  | ManagedByProvider
  | InvalidAvatar
  | InvalidIcon
  | ProviderRejected
  | TooManyAttempts
  | TailscaleServeUnavailable
  | RpcClientError.RpcClientError;

/** The most recent fleet from the hub and when the dashboard received it. */
export type FleetSnapshot = { readonly fleet: Fleet; readonly receivedAt: DateTime.Utc };

export type HubState =
  | { readonly _tag: "Connecting" }
  | { readonly _tag: "Live"; readonly snapshot: FleetSnapshot }
  /** The last snapshot stays visible, marked stale, while the dashboard reconnects. */
  | { readonly _tag: "Reconnecting"; readonly snapshot: FleetSnapshot | null };

const retryDelay = Duration.seconds(2);

const noRuns: RunsSnapshot = { activeBatches: [], active: [], latest: [] };

let state: HubState = { _tag: "Connecting" };
let client: DashboardClient | null = null;
/** Active runs and each checkout's latest result, kept through a reconnect. */
let runs: RunsSnapshot = noRuns;
const listeners = new Set<() => void>();
/**
 * Set once the hub sends something this page can't read, which happens when the hub was updated
 * after the page loaded. Only reloading the page fixes it.
 */
let outdated = false;

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function setState(next: HubState): void {
  state = next;
  notify();
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

export function useRuns(): RunsSnapshot {
  return useSyncExternalStore(subscribe, () => runs);
}

/** Whether the hub was updated since this page loaded, so the page needs reloading. */
export function useDashboardOutdated(): boolean {
  return useSyncExternalStore(subscribe, () => outdated);
}

/** Whether the connection failed on data this version of the dashboard can't decode. */
function isSchemaMismatch(cause: Cause.Cause<unknown>): boolean {
  return cause.reasons.some((reason) => {
    if (Cause.isFailReason(reason)) {
      return Predicate.isTagged(reason.error, "SchemaError");
    }

    return Cause.isDieReason(reason) && Predicate.isTagged(reason.defect, "SchemaError");
  });
}

/** The connected client, or null while connecting. Changes on every reconnect. */
export function useHubClient(): DashboardClient | null {
  return useSyncExternalStore(subscribe, () => client);
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
  notify();
  yield* Effect.all(
    [
      connected
        .WatchFleet()
        .pipe(
          Stream.runForEach((fleet) =>
            DateTime.now.pipe(
              Effect.map((receivedAt) =>
                setState({ _tag: "Live", snapshot: { fleet, receivedAt } }),
              ),
            ),
          ),
        ),
      connected.WatchRuns().pipe(
        Stream.runForEach((snapshot) =>
          Effect.sync(() => {
            runs = snapshot;
            notify();
          }),
        ),
      ),
    ],
    { concurrency: "unbounded", discard: true },
  ).pipe(Effect.raceFirst(Deferred.await(dropped)));
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

/** Forgets what the last user could see, so the next one starts from nothing. */
function forget(): void {
  runs = noRuns;
  setState({ _tag: "Connecting" });
}

/**
 * Connects to the hub for the lifetime of the page, reconnecting after any drop. A drop can mean
 * the session ended, so it asks who is signed in first, and waits while no one is.
 */
export function startHubConnection(): void {
  Effect.runFork(
    Effect.promise(whenAccessible).pipe(
      Effect.andThen(session),
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          if (isSchemaMismatch(cause) && !outdated) {
            outdated = true;
            notify();
          }
        }).pipe(Effect.andThen(Effect.logWarning("Hub connection lost", cause))),
      ),
      Effect.andThen(Effect.sleep(retryDelay)),
      Effect.andThen(Effect.promise(refreshSession)),
      Effect.tap((current) =>
        Effect.sync(() => {
          if (current._tag === "Known" && current.session._tag === "SignedOut") {
            forget();
          }
        }),
      ),
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
  RepositoryNotFound: "That repository is no longer on any machine.",
  NothingToRun: "There's nothing to run. The checkouts may have moved since the last scan.",
  NoCloneSource:
    "No machine has an HTTPS or SSH origin for this repository, so there's nothing to clone from.",
  BatchNotFound: "That action is no longer in the history.",
  InvalidArchiveFolder:
    "That folder can't be this machine's Archive folder. It may hold one of its project folders.",
  AgentNotUpdatable:
    "The agent can't update now. It may be offline, not allowed to update, already updating or already on the hub's version.",
  NotSignedIn: "You've been signed out. Sign in again to continue.",
  Forbidden: "Only admins can do that.",
  UserNotFound: "That user no longer exists.",
  EmailTaken: "Another user already has that email address.",
  LastAdmin: "The hub needs at least one admin. Make someone else an admin first.",
  WrongPassword: "Your current password is wrong.",
  ManagedByProvider: "Your sign-in provider sets this, so change it there.",
  InvalidAvatar: "Choose a PNG, JPEG or WebP image under 512 KB.",
  ProviderRejected: "The sign-in provider didn't accept those settings.",
  InvalidIcon: "Choose a PNG, JPEG, WebP, SVG or ICO image under 256 KB.",
  TooManyAttempts: "Too many wrong passwords. Wait a few minutes, then try again.",
  TailscaleServeUnavailable: "The hub couldn't find its address on your tailnet.",
  RpcClientError: "The hub did not respond. Check that it is still running.",
} satisfies Record<DashboardError["_tag"], string>;

export function describeCause(cause: Cause.Cause<DashboardError>): string {
  const error = Cause.findError(cause);

  if (Result.isFailure(error)) {
    return "Something went wrong talking to the hub. Try again.";
  }

  // These carry the hub's own reason, which says what to fix.
  return error.success._tag === "ProviderRejected" ||
    error.success._tag === "TailscaleServeUnavailable"
    ? error.success.message
    : failureMessages[error.success._tag];
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
