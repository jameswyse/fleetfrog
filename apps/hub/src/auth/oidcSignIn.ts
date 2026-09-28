import { Clock, Context, Duration, Effect, Layer, Option, Schema, SubscriptionRef } from "effect";
import * as oidc from "openid-client";

import { Email } from "@fleetfrog/protocol/domain/user";

import { AuthSettingsStore } from "./authSettingsStore.ts";
import { UserStore } from "./userStore.ts";

import type { OidcSettings, Role } from "@fleetfrog/protocol/domain/user";

import type { UserRecord } from "./userStore.ts";

/** Why signing in through the provider didn't work, in words for the person trying. */
/**
 * `SignIn` signs someone in while the provider is in use. `Activate` is an admin's test sign-in
 * that turns the provider on once it works, making them an admin.
 */
export const OidcIntent = Schema.Literals(["SignIn", "Activate"]);
export type OidcIntent = typeof OidcIntent.Type;

export class OidcFailure extends Schema.TaggedError<OidcFailure>()("OidcFailure", {
  message: Schema.String,
  /** What the failed attempt was for, which decides where to explain it. */
  intent: OidcIntent,
}) {}

/** How long someone has to finish signing in at the provider. */
const pendingLifetime = Duration.minutes(10);

interface Pending {
  readonly intent: OidcIntent;
  readonly redirect: string;
  readonly verifier: string;
  readonly nonce: string;
  readonly startedAt: number;
}

const Claims = Schema.Struct({
  sub: Schema.String,
  email: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  preferred_username: Schema.optionalKey(Schema.String),
  picture: Schema.optionalKey(Schema.String),
  groups: Schema.optionalKey(Schema.Array(Schema.String)),
});
const decodeClaims = Schema.decodeUnknownOption(Claims);
const decodeEmail = Schema.decodeUnknownOption(Email);

export function callbackUrl(settings: OidcSettings): URL {
  return new URL("/auth/oidc/callback", settings.dashboardUrl);
}

/** The library's message and, when it has one, the more specific reason behind it. */
function describe(cause: unknown): string {
  if (!(cause instanceof Error)) {
    return String(cause);
  }

  return cause.cause instanceof Error ? `${cause.message}: ${cause.cause.message}` : cause.message;
}

function roleFromGroups(adminGroup: string | null, groups: ReadonlyArray<string>): Role | null {
  if (adminGroup === null) {
    return null;
  }

  return groups.includes(adminGroup) ? "admin" : "user";
}

function failure(message: string) {
  return new OidcFailure({ message, intent: "SignIn" });
}

/** Marks a failure as belonging to what the attempt was for. */
function during(intent: OidcIntent) {
  return Effect.mapError(
    (error: OidcFailure) => new OidcFailure({ message: error.message, intent }),
  );
}

/** Signs people in through the configured OpenID Connect provider. */
export class OidcSignIn extends Context.Service<
  OidcSignIn,
  {
    /** Checks that the provider answers discovery for these settings. */
    readonly check: (settings: OidcSettings) => Effect.Effect<void, OidcFailure>;
    /** Where to send the browser to sign in at the provider. */
    readonly start: (request: {
      readonly intent: OidcIntent;
      readonly redirect: string;
    }) => Effect.Effect<{ readonly url: URL; readonly state: string }, OidcFailure>;
    /** Finishes a sign-in from the provider's redirect back, returning who signed in. */
    readonly finish: (callback: {
      /** The path and query the provider redirected to. */
      readonly url: string;
    }) => Effect.Effect<
      {
        readonly user: UserRecord;
        /** The provider's groups gave them another role, so their other sessions should end. */
        readonly roleChanged: boolean;
        readonly intent: OidcIntent;
        readonly redirect: string;
      },
      OidcFailure
    >;
  }
>()("fleetfrog/OidcSignIn") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const auth = yield* AuthSettingsStore;
      const users = yield* UserStore;
      const pending = new Map<string, Pending>();
      // Discovery is fetched once for each set of settings, and again once they change.
      let discovered: { readonly key: string; readonly config: oidc.Configuration } | null = null;

      const discover = (settings: OidcSettings) =>
        Effect.gen(function* () {
          const key = JSON.stringify(settings);

          if (discovered?.key === key) {
            return discovered.config;
          }

          const config = yield* Effect.tryPromise({
            try: () =>
              oidc.discovery(
                new URL(settings.issuerUrl),
                settings.clientId,
                settings.clientSecret,
                undefined,
                // A provider on a private network may well be plain HTTP.
                settings.issuerUrl.startsWith("http:")
                  ? { execute: [oidc.allowInsecureRequests] }
                  : undefined,
              ),
            catch: (cause) =>
              failure(
                `FleetFrog couldn't read the provider's details from ${settings.issuerUrl}. Check the issuer URL. (${describe(cause)})`,
              ),
          });

          discovered = { key, config };

          return config;
        });

      const configured = SubscriptionRef.get(auth.settings).pipe(
        Effect.flatMap(({ oidc: settings }) =>
          settings === null
            ? Effect.fail(failure("No sign-in provider is set up."))
            : Effect.succeed(settings),
        ),
      );

      return {
        check: (settings) => discover(settings).pipe(Effect.asVoid),
        start: ({ intent, redirect }) =>
          Effect.gen(function* () {
            const settings = yield* configured;
            const config = yield* discover(settings);
            const now = yield* Clock.currentTimeMillis;
            const state = oidc.randomState();
            const nonce = oidc.randomNonce();
            const verifier = oidc.randomPKCECodeVerifier();
            const challenge = yield* Effect.promise(() =>
              oidc.calculatePKCECodeChallenge(verifier),
            );

            for (const [key, entry] of pending) {
              if (now - entry.startedAt > Duration.toMillis(pendingLifetime)) {
                pending.delete(key);
              }
            }

            pending.set(state, { intent, redirect, verifier, nonce, startedAt: now });

            return {
              url: oidc.buildAuthorizationUrl(config, {
                redirect_uri: callbackUrl(settings).href,
                scope: "openid email profile",
                code_challenge: challenge,
                code_challenge_method: "S256",
                state,
                nonce,
              }),
              state,
            };
          }).pipe(during(intent)),
        finish: ({ url }) =>
          Effect.gen(function* () {
            const settings = yield* configured;
            const config = yield* discover(settings);
            const current = new URL(url, settings.dashboardUrl);
            const state = current.searchParams.get("state") ?? "";
            const started = pending.get(state);
            const now = yield* Clock.currentTimeMillis;

            pending.delete(state);

            if (
              started === undefined ||
              now - started.startedAt > Duration.toMillis(pendingLifetime)
            ) {
              return yield* failure("That sign-in took too long or was already used. Try again.");
            }

            return yield* Effect.gen(function* () {
              const providerError = current.searchParams.get("error_description");

              if (providerError !== null) {
                return yield* failure(`The provider said: ${providerError}`);
              }

              const tokens = yield* Effect.tryPromise({
                try: () =>
                  oidc.authorizationCodeGrant(config, current, {
                    pkceCodeVerifier: started.verifier,
                    expectedState: state,
                    expectedNonce: started.nonce,
                    idTokenExpected: true,
                  }),
                catch: (cause) =>
                  failure(`The provider didn't complete the sign-in. (${describe(cause)})`),
              });
              const fromToken = tokens.claims();
              // Some providers put the profile only in the ID token, others only behind userinfo.
              const fromUserInfo = yield* Effect.tryPromise(() =>
                oidc.fetchUserInfo(
                  config,
                  tokens.access_token,
                  fromToken?.sub ?? oidc.skipSubjectCheck,
                ),
              ).pipe(Effect.orElseSucceed(() => ({})));
              const claims = decodeClaims({ ...fromToken, ...fromUserInfo });

              if (Option.isNone(claims)) {
                return yield* failure("The provider didn't say who signed in.");
              }

              const { sub, email, name, preferred_username, picture, groups = [] } = claims.value;
              const address = decodeEmail(email);

              if (Option.isNone(address)) {
                return yield* failure(
                  "The provider didn't share an email address. Allow FleetFrog the email scope.",
                );
              }

              if (settings.requiredGroup !== null && !groups.includes(settings.requiredGroup)) {
                return yield* failure(
                  `Only members of the ${settings.requiredGroup} group can sign in to FleetFrog.`,
                );
              }

              // With an admin group, the provider's groups decide the role at every sign-in.
              const groupRole = roleFromGroups(settings.adminGroup, groups);

              if (started.intent === "Activate" && groupRole === "user") {
                return yield* failure(
                  `You aren't in the ${settings.adminGroup} group, which makes people admins, so turning this on would lock you out of Settings.`,
                );
              }

              const { user, roleChanged } = yield* users
                .signInFromProvider({
                  issuer: config.serverMetadata().issuer,
                  subject: sub,
                  email: address.value,
                  name: name ?? preferred_username ?? null,
                  picture: picture ?? null,
                  role: started.intent === "Activate" ? "admin" : groupRole,
                })
                .pipe(
                  Effect.catchTag("EmailTaken", () =>
                    Effect.fail(
                      failure(
                        `Another FleetFrog user already has ${address.value} as their email.`,
                      ),
                    ),
                  ),
                );

              return { user, roleChanged, intent: started.intent, redirect: started.redirect };
            }).pipe(during(started.intent));
          }),
      };
    }),
  );
}
