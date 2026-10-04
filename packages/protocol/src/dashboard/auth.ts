import { Schema } from "effect";

import { Preferences } from "../domain/preferences.ts";
import { DisplayName, Email, Password, PasswordAttempt, User } from "../domain/user.ts";

export const TailscaleIdentity = Schema.Struct({
  login: Schema.String,
  name: Schema.String,
});
export type TailscaleIdentity = typeof TailscaleIdentity.Type;

export const SignInMethods = Schema.Struct({
  passwords: Schema.Boolean,
  provider: Schema.NullOr(
    Schema.Struct({ name: Schema.String, icon: Schema.NullOr(Schema.String) }),
  ),
  tailscale: Schema.NullOr(Schema.Struct({ identity: Schema.NullOr(TailscaleIdentity) })),
});
export type SignInMethods = typeof SignInMethods.Type;

export const Session = Schema.TaggedUnion({
  Open: { preferences: Preferences },
  SignedOut: { methods: SignInMethods },
  SignedIn: { methods: SignInMethods, user: User, preferences: Preferences },
});
export type Session = typeof Session.Type;

export function localPath(redirect: string | null | undefined): string {
  const base = "http://dashboard.invalid";

  if (redirect === null || redirect === undefined || !URL.canParse(redirect, base)) {
    return "/";
  }

  const url = new URL(redirect, base);
  const path = `${url.pathname}${url.search}${url.hash}`;

  return url.origin === base && new URL(path, base).origin === base ? path : "/";
}

export const SignInFailure = Schema.Literals([
  "ProviderOff",
  "NotSetUp",
  "OtherBrowser",
  "Expired",
  "SignInOff",
  "ProviderUnreachable",
  "ProviderRefused",
  "Incomplete",
  "NoIdentity",
  "NoEmail",
  "NotInRequiredGroup",
  "NotInAdminGroup",
  "EmailTaken",
]);
export type SignInFailure = typeof SignInFailure.Type;

export const LoginRequest = Schema.Struct({ email: Email, password: PasswordAttempt });
export type LoginRequest = typeof LoginRequest.Type;

export const LoginFailure = Schema.TaggedUnion({
  InvalidCredentials: {},
  TooManyAttempts: { retryAfterSeconds: Schema.Int },
});
export type LoginFailure = typeof LoginFailure.Type;

export const MethodChange = Schema.TaggedUnion({
  TurnOff: {},
  EnablePasswords: { email: Email, displayName: DisplayName, password: Password },
  DisablePasswords: {},
  EnableProvider: {},
  DisableProvider: {},
  EnableTailscale: {},
  DisableTailscale: {},
});
export type MethodChange = typeof MethodChange.Type;
