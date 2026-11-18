import { Context, Effect, Layer, Option, Schema, Stream, Struct, SubscriptionRef } from "effect";
import { SqlClient } from "effect/sql";

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

export class AuthSettingsStore extends Context.Service<
  AuthSettingsStore,
  {
    readonly settings: SubscriptionRef.SubscriptionRef<AuthSettings>;
    readonly methods: Effect.Effect<SignInSwitches>;
    readonly overridden: boolean;
    readonly modify: <A>(
      change: (current: AuthSettings) => readonly [A, AuthSettings],
    ) => Effect.Effect<A>;
    readonly update: (change: (current: AuthSettings) => AuthSettings) => Effect.Effect<void>;
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

      const save = (auth: AuthSettings) =>
        sql`insert into settings ${sql.insert({
          id: 1,
          polling_json: encodePolling(defaultPollingSettings),
          auth_json: encodeAuth(auth),
        })} on conflict (id) do update set auth_json = excluded.auth_json`.pipe(Effect.orDie);

      const modify = <A>(change: (current: AuthSettings) => readonly [A, AuthSettings]) =>
        SubscriptionRef.modifySomeEffect(settings, (current) => {
          const [result, next] = change(current);

          return next === current
            ? Effect.succeed([result, Option.none()] as const)
            : save(next).pipe(Effect.as([result, Option.some(next)] as const));
        }).pipe(Effect.uninterruptible, Effect.withSpan("AuthSettingsStore.modify"));

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
        modify,
        update: Effect.fn("AuthSettingsStore.update")((change) =>
          modify((current) => [undefined, change(current)]),
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
