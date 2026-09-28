import { Context, Effect, Layer, Schema, Stream, Struct, SubscriptionRef } from "effect";
import { SqlClient } from "effect/unstable/sql";

import { defaultPollingSettings, PollingSettings } from "@fleetfrog/protocol/domain/polling";
import { AuthSettings, defaultAuthSettings } from "@fleetfrog/protocol/domain/user";

import { HubConfig } from "../hubConfig.ts";
import { JsonColumn } from "../persistence/database.ts";

import type { AuthSettingsView, SignInSwitches } from "@fleetfrog/protocol/domain/user";

const AuthJson = JsonColumn(AuthSettings);
const encodeAuth = Schema.encodeSync(AuthJson);
const encodePolling = Schema.encodeSync(JsonColumn(PollingSettings));
const decodeRows = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ auth_json: Schema.NullOr(AuthJson) })),
);

/** The hub's sign-in settings, persisted and observable. */
export class AuthSettingsStore extends Context.Service<
  AuthSettingsStore,
  {
    readonly settings: SubscriptionRef.SubscriptionRef<AuthSettings>;
    /** The ways of signing in in force, which `FLEETFROG_AUTH_MODE` can turn off. */
    readonly methods: Effect.Effect<SignInSwitches>;
    /** Whether `FLEETFROG_AUTH_MODE` has turned sign-in off. */
    readonly overridden: boolean;
    readonly update: (auth: AuthSettings) => Effect.Effect<void>;
    /** The settings as admins see them, on subscribe and after every change. */
    readonly watch: Stream.Stream<Omit<AuthSettingsView, "icon">>;
  }
>()("fleetfrog/AuthSettingsStore") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const { authModeOverride, dashboardSocket } = yield* HubConfig;
      const [stored] = yield* sql`select auth_json from settings where id = 1`.pipe(
        Effect.flatMap(decodeRows),
        Effect.orDie,
      );
      const settings = yield* SubscriptionRef.make(stored?.auth_json ?? defaultAuthSettings);

      return {
        settings,
        methods: SubscriptionRef.get(settings).pipe(
          Effect.map(({ passwords, provider, tailscale }) =>
            authModeOverride === null
              ? { passwords, provider, tailscale }
              : { passwords: false, provider: false, tailscale: false },
          ),
        ),
        overridden: authModeOverride !== null,
        // The settings row may not exist yet, and it needs polling intervals to be created.
        update: (auth) =>
          sql`insert into settings ${sql.insert({
            id: 1,
            polling_json: encodePolling(defaultPollingSettings),
            auth_json: encodeAuth(auth),
          })} on conflict (id) do update set auth_json = excluded.auth_json`.pipe(
            Effect.orDie,
            Effect.andThen(SubscriptionRef.set(settings, auth)),
          ),
        watch: SubscriptionRef.changes(settings).pipe(
          Stream.map(({ passwords, provider, tailscale, gravatar, oidc }) => ({
            passwords,
            provider,
            tailscale,
            tailscaleAvailable: dashboardSocket !== null,
            overridden: authModeOverride !== null,
            gravatar,
            oidc: oidc === null ? null : Struct.omit(oidc, ["clientSecret"]),
          })),
        ),
      };
    }),
  );
}
