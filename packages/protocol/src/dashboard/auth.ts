import { Schema } from "effect";

import { DisplayName, Email, Password, User } from "../domain/user.ts";

/**
 * Sign-in runs over plain HTTP under `/auth`, because the browser needs its session cookie before
 * it opens the dashboard socket.
 */
export const SignInMethods = Schema.Struct({
  passwords: Schema.Boolean,
  /** The provider's name and button icon, when people can sign in through it. */
  provider: Schema.NullOr(
    Schema.Struct({ name: Schema.String, icon: Schema.NullOr(Schema.String) }),
  ),
});
export type SignInMethods = typeof SignInMethods.Type;

/** `GET /auth/session`: whether the dashboard needs a sign-in, and who is signed in. */
export const Session = Schema.TaggedUnion({
  /** Sign-in is off, so everyone is an admin. */
  Open: {},
  SignedOut: { methods: SignInMethods },
  SignedIn: { methods: SignInMethods, user: User },
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
 * `POST /auth/methods`, for admins, answered with the new `Session`, or 409 and the reason in
 * plain text. A change that could lock out the admin making it is refused.
 *
 * Turning passwords on sets the admin's own email and password, creating their account when there
 * isn't one. When sign-in was off, it signs them in and ends every other session, including
 * everyone who was using the dashboard with sign-in off. Turning a way of signing in off ends
 * every session but the admin's own.
 */
export const MethodChange = Schema.TaggedUnion({
  TurnOff: {},
  EnablePasswords: { email: Email, displayName: DisplayName, password: Password },
  DisablePasswords: {},
  /** Only while sign-in is on. With it off, an admin turns the provider on by signing in through it. */
  EnableProvider: {},
  DisableProvider: {},
});
export type MethodChange = typeof MethodChange.Type;
