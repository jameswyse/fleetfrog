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

export function onSessionChange(listener: (state: SessionState) => void): void {
  subscribe(() => listener(state));
}

export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, () => state);
}

function roleOf(current: SessionState): Role {
  return current._tag === "Known" && current.session._tag === "SignedIn"
    ? current.session.user.role
    : "admin";
}

export function useRole(): Role {
  return useSyncExternalStore(subscribe, () => roleOf(state));
}

export function useMayRun(kind: ActionKind): boolean {
  return mayRun(useRole(), kind);
}

export function isSignedOut(current: SessionState): boolean {
  return current._tag === "Known" && current.session._tag === "SignedOut";
}

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

function hasAccess(current: SessionState): boolean {
  return current._tag !== "Loading" && !isSignedOut(current);
}

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

function withoutAnswer(): SessionState {
  return state._tag === "Known" ? state : { _tag: "Unreachable" };
}

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

const renewalInterval = 6 * 60 * 60 * 1000;

export function startSession(): void {
  void refreshSession();
  setInterval(() => void refreshSession(), renewalInterval);
}

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

    await refreshSession();

    return { _tag: "Failure", message: "Password sign-in is off. Reload the page." };
  } catch {
    return unreachable;
  }
}

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

export async function signOut(): Promise<void> {
  await fetch("/auth/logout", { method: "POST" }).catch(() => undefined);
  window.location.assign("/login");
}

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
