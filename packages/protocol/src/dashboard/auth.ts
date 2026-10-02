import { Schema } from "effect";

import { Preferences } from "../domain/preferences.ts";
import { DisplayName, Email, Password, PasswordAttempt, User } from "../domain/user.ts";

/** A tailnet user, from the identity headers Tailscale Serve adds to each request. */
export const TailscaleIdentity = Schema.Struct({
  /** Tailscale's login name, such as `alice@example.com` or `alice@github`. */
  login: Schema.String,
  name: Schema.String,
});
export type TailscaleIdentity = typeof TailscaleIdentity.Type;

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
  /**
   * Present when people can sign in through Tailscale. The identity is who Tailscale Serve says
   * sent the request, and is null when the dashboard wasn't opened through Serve.
   */
  tailscale: Schema.NullOr(Schema.Struct({ identity: Schema.NullOr(TailscaleIdentity) })),
});
export type SignInMethods = typeof SignInMethods.Type;

/**
 * `GET /auth/session`: whether the dashboard needs a sign-in, who is signed in, and how the
 * dashboard looks to them.
 */
export const Session = Schema.TaggedUnion({
  /** Sign-in is off, so everyone is an admin and shares one set of preferences. */
  Open: { preferences: Preferences },
  SignedOut: { methods: SignInMethods },
  SignedIn: { methods: SignInMethods, user: User, preferences: Preferences },
});
export type Session = typeof Session.Type;

/**
 * Where to go after signing in, as a path on this site. Anything that resolves to another origin,
 * such as `//evil.example` or `/\evil.example`, becomes the dashboard's home. So does a path that
 * would once it's followed, such as `/.//evil.example`, whose `.` segment collapses to leave
 * `//evil.example`.
 */
export function localPath(redirect: string | null | undefined): string {
  const base = "http://dashboard.invalid";

  if (redirect === null || redirect === undefined || !URL.canParse(redirect, base)) {
    return "/";
  }

  const url = new URL(redirect, base);
  const path = `${url.pathname}${url.search}${url.hash}`;

  return url.origin === base && new URL(path, base).origin === base ? path : "/";
}

/**
 * Why a sign-in through the provider didn't work. The hub sends the browser back with one of these
 * in the address and logs the details. The dashboard shows each in its own words and ignores
 * anything else, so a link can't put other text on the sign-in page.
 */
export const SignInFailure = Schema.Literals([
  /** Signing in through the provider is off. */
  "ProviderOff",
  /** No provider is set up. */
  "NotSetUp",
  /** The callback came to a browser that didn't start the sign-in. */
  "OtherBrowser",
  /** The sign-in took too long or was already used. */
  "Expired",
  /** `FLEETFROG_AUTH_MODE` keeps sign-in off. */
  "SignInOff",
  /** The hub couldn't read the provider's discovery document. */
  "ProviderUnreachable",
  /** The provider sent back an error instead of signing the person in. */
  "ProviderRefused",
  /** Exchanging the code or reading the profile failed. */
  "Incomplete",
  /** The provider's claims didn't name the person. */
  "NoIdentity",
  /** The provider didn't share an email address. */
  "NoEmail",
  /** The person isn't in the group that may sign in. */
  "NotInRequiredGroup",
  /** An admin's test sign-in, from someone outside the admin group. */
  "NotInAdminGroup",
  /** Another account already has the email, and the provider hasn't verified it. */
  "EmailTaken",
]);
export type SignInFailure = typeof SignInFailure.Type;

/**
 * `POST /auth/login`, answered with the new `Session` or a `LoginFailure`. A password longer than
 * any that could have been set is refused before it's hashed.
 */
export const LoginRequest = Schema.Struct({ email: Email, password: PasswordAttempt });
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
  /**
   * Makes the Tailscale user who sent the request an admin and signs them in, so it must come
   * through Tailscale Serve. When sign-in was off, it ends every other session.
   */
  EnableTailscale: {},
  DisableTailscale: {},
});
export type MethodChange = typeof MethodChange.Type;
