import { useSyncExternalStore } from "react";

import { Option, Schema } from "effect";

import { LoginFailure, Session } from "@fleetfrog/protocol/dashboard/auth";
import { mayRun } from "@fleetfrog/protocol/domain/user";

import type { MethodChange } from "@fleetfrog/protocol/dashboard/auth";
import type { ActionKind } from "@fleetfrog/protocol/domain/action";
import type { Role, User } from "@fleetfrog/protocol/domain/user";

export type SessionState =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Known"; readonly session: Session }
  /**
   * The hub didn't answer before it ever said who is signed in, so the dashboard carries on as if
   * it were open and keeps trying.
   */
  | { readonly _tag: "Unreachable" };

const decodeSession = Schema.decodeUnknownOption(Schema.toCodecJson(Session));
const decodeFailure = Schema.decodeUnknownOption(Schema.toCodecJson(LoginFailure));

let state: SessionState = { _tag: "Loading" };
const listeners = new Set<() => void>();

function setState(next: SessionState): void {
  state = next;

  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, () => state);
}

function roleOf(current: SessionState): Role {
  return current._tag === "Known" && current.session._tag === "SignedIn"
    ? current.session.user.role
    : "admin";
}

/** What the dashboard offers. With sign-in off everyone is an admin, and the hub checks anyway. */
export function useRole(): Role {
  return useSyncExternalStore(subscribe, () => roleOf(state));
}

/** Whether the signed-in user may start this kind of action. */
export function useMayRun(kind: ActionKind): boolean {
  return mayRun(useRole(), kind);
}

/** Whether no one is signed in and sign-in is on, so the dashboard shows the sign-in page. */
export function isSignedOut(current: SessionState): boolean {
  return current._tag === "Known" && current.session._tag === "SignedOut";
}

/** The session once the hub has answered, or failed to. */
export function settledSession(): Promise<SessionState> {
  if (state._tag !== "Loading") {
    return Promise.resolve(state);
  }

  return new Promise((resolve) => {
    const unsubscribe = subscribe(() => {
      if (state._tag !== "Loading") {
        unsubscribe();
        resolve(state);
      }
    });
  });
}

/** Whether the dashboard may open its socket: sign-in is off, someone is signed in, or it can't tell. */
function hasAccess(current: SessionState): boolean {
  return current._tag !== "Loading" && !isSignedOut(current);
}

/** Resolves once the dashboard may open its socket. */
export function whenAccessible(): Promise<void> {
  if (hasAccess(state)) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const unsubscribe = subscribe(() => {
      if (hasAccess(state)) {
        unsubscribe();
        resolve();
      }
    });
  });
}

async function readSession(response: Response): Promise<Option.Option<Session>> {
  return decodeSession(await response.json());
}

/**
 * What to show when the hub can't say who is signed in. A session it already reported stays, so an
 * outage doesn't take away the account menu or change which pages the header offers.
 */
function withoutAnswer(): SessionState {
  return state._tag === "Known" ? state : { _tag: "Unreachable" };
}

/** Asks the hub who is signed in, which also keeps the session going. */
export async function refreshSession(): Promise<SessionState> {
  try {
    const response = await fetch("/auth/session");
    const session = response.ok ? await readSession(response) : Option.none();

    setState(
      Option.match(session, {
        onNone: withoutAnswer,
        onSome: (known) => ({ _tag: "Known", session: known }),
      }),
    );
  } catch {
    setState(withoutAnswer());
  }

  return state;
}

/** How often an open page renews its session, which lasts 30 days from the last renewal. */
const renewalInterval = 6 * 60 * 60 * 1000;

/** Asks who is signed in now, then keeps renewing the session for as long as the page is open. */
export function startSession(): void {
  void refreshSession();
  setInterval(() => void refreshSession(), renewalInterval);
}

/** Shows the signed-in user as the hub last described them, such as after a profile change. */
export function replaceUser(user: User): void {
  if (state._tag === "Known" && state.session._tag === "SignedIn") {
    setState({ _tag: "Known", session: { ...state.session, user } });
  }
}

export type Outcome =
  | { readonly _tag: "Success" }
  | { readonly _tag: "Failure"; readonly message: string };

const unreachable: Outcome = {
  _tag: "Failure",
  message: "Can't reach the hub. Check that it's running, then try again.",
};

function waitMessage(seconds: number): string {
  return seconds < 90
    ? `Too many attempts. Try again in ${seconds} seconds.`
    : `Too many attempts. Try again in ${Math.ceil(seconds / 60)} minutes.`;
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function signIn(credentials: {
  readonly email: string;
  readonly password: string;
}): Promise<Outcome> {
  try {
    const response = await post("/auth/login", credentials);

    if (response.ok) {
      const session = await readSession(response);

      if (Option.isSome(session)) {
        setState({ _tag: "Known", session: session.value });

        return { _tag: "Success" };
      }
    }

    if (response.status === 401 || response.status === 429) {
      const failure = decodeFailure(await response.json());

      if (Option.isSome(failure)) {
        return {
          _tag: "Failure",
          message:
            failure.value._tag === "InvalidCredentials"
              ? "That email and password don't match an account."
              : waitMessage(failure.value.retryAfterSeconds),
        };
      }
    }

    if (response.status === 400) {
      return { _tag: "Failure", message: "Enter your email address and password." };
    }

    // Password sign-in has been turned off since the page loaded.
    await refreshSession();

    return { _tag: "Failure", message: "Password sign-in is off. Reload the page." };
  } catch {
    return unreachable;
  }
}

/** Signs in as the tailnet user Tailscale Serve says opened the dashboard. */
export async function signInWithTailscale(): Promise<Outcome> {
  try {
    const response = await fetch("/auth/tailscale", { method: "POST" });
    const session = response.ok ? await readSession(response) : Option.none();

    if (Option.isSome(session)) {
      setState({ _tag: "Known", session: session.value });

      return { _tag: "Success" };
    }

    return {
      _tag: "Failure",
      message:
        response.status === 409 ? await response.text() : "The hub didn't sign you in. Try again.",
    };
  } catch {
    return unreachable;
  }
}

/**
 * Signs out and loads the sign-in page afresh, forgetting the page they were on, so whoever signs
 * in next starts at Projects and nothing from this session stays in memory.
 */
export async function signOut(): Promise<void> {
  await fetch("/auth/logout", { method: "POST" }).catch(() => undefined);
  window.location.assign("/login");
}

/**
 * Turns a way of signing in on or off. The hub refuses a change that would lock the admin out,
 * saying why.
 */
export async function changeMethods(change: MethodChange): Promise<Outcome> {
  try {
    const response = await post("/auth/methods", change);
    const session = response.ok ? await readSession(response) : Option.none();

    if (Option.isSome(session)) {
      setState({ _tag: "Known", session: session.value });

      return { _tag: "Success" };
    }

    return {
      _tag: "Failure",
      message:
        response.status === 409
          ? await response.text()
          : "The hub didn't accept that change. Try again.",
    };
  } catch {
    return unreachable;
  }
}
