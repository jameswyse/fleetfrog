import { Schema } from "effect";

import { DisplayName, Email, Password, User } from "../domain/user.ts";

/**
 * Sign-in runs over plain HTTP under `/auth`, because the browser needs its session cookie before
 * it opens the dashboard socket.
 */
export const SignInMethod = Schema.TaggedUnion({
  Password: {},
  Provider: { name: Schema.String },
});
export type SignInMethod = typeof SignInMethod.Type;

/** `GET /auth/session`: whether the dashboard needs a sign-in, and who is signed in. */
export const Session = Schema.TaggedUnion({
  /** Sign-in is off, so everyone is an admin. */
  Open: {},
  SignedOut: { method: SignInMethod },
  SignedIn: { method: SignInMethod, user: User },
});
export type Session = typeof Session.Type;

/**
 * Where to go after signing in, as a path on this site. Anything that resolves to another origin,
 * such as `//evil.example` or `/\evil.example`, becomes the dashboard's home.
 */
export function localPath(redirect: string | null | undefined): string {
  const base = "http://dashboard.invalid";

  if (redirect === null || redirect === undefined || !URL.canParse(redirect, base)) {
    return "/";
  }

  const url = new URL(redirect, base);

  return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : "/";
}

/** `POST /auth/login`, answered with the new `Session` or a `LoginFailure`. */
export const LoginRequest = Schema.Struct({ email: Email, password: Schema.String });
export type LoginRequest = typeof LoginRequest.Type;

export const LoginFailure = Schema.TaggedUnion({
  InvalidCredentials: {},
  TooManyAttempts: { retryAfterSeconds: Schema.Int },
});
export type LoginFailure = typeof LoginFailure.Type;

/**
 * `POST /auth/mode`, for admins, answered with the new `Session`. Turning local sign-in on sets
 * the admin's own email and password, creating their account when there isn't one, and signs
 * them in. Every other session ends.
 */
export const ModeChange = Schema.TaggedUnion({
  None: {},
  Local: { email: Email, displayName: DisplayName, password: Password },
});
export type ModeChange = typeof ModeChange.Type;
