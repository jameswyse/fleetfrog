import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, SubscriptionRef } from "effect";
import { SqlClient } from "effect/unstable/sql";

import { AuthSettingsStore } from "../../auth/authSettingsStore.ts";
import { HubConfig } from "../../hubConfig.ts";
import { migrations } from "../database.ts";

const before = Object.fromEntries(Object.entries(migrations).filter(([name]) => name < "0012"));

const oidc = {
  providerName: "Authentik",
  issuerUrl: "https://auth.example.com/application/o/fleetfrog/",
  clientId: "fleetfrog",
  clientSecret: "s3cret",
  dashboardUrl: "https://fleetfrog.example.com",
  adminGroup: "fleetfrog-admins",
  requiredGroup: null,
};

/** The settings as 0.2.0 stored them, with one mode, then fully migrated. */
const storedAs = (mode: "none" | "local" | "oidc") =>
  AuthSettingsStore.layer.pipe(
    Layer.provide(
      Layer.effectDiscard(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;

          yield* SqliteMigrator.run({ loader: SqliteMigrator.fromRecord(before) });
          yield* sql`insert into settings ${sql.insert({
            id: 1,
            polling_json: JSON.stringify({
              idleStatusSeconds: 300,
              watchingStatusSeconds: 30,
              discoverySeconds: 1800,
              githubSeconds: 900,
            }),
            auth_json: JSON.stringify({ mode, gravatar: false, oidc }),
          })}`;
          yield* SqliteMigrator.run({ loader: SqliteMigrator.fromRecord(migrations) });
        }),
      ),
    ),
    Layer.provide(SqliteClient.layer({ filename: ":memory:" })),
    Layer.provide(
      Layer.succeed(HubConfig)({
        dataDirectory: "unused",
        dashboardPort: 7420,
        agentPort: 7421,
        agentTls: "self-signed",
        agentUrl: null,
        webRoot: null,
        authModeOverride: null,
      }),
    ),
  );

describe("0012_sign_in_methods", () => {
  it.each([
    ["none", { passwords: false, provider: false }],
    ["local", { passwords: true, provider: false }],
    ["oidc", { passwords: false, provider: true }],
  ] as const)("turns the %s mode into its own switches, keeping the rest", (mode, methods) =>
    Effect.gen(function* () {
      const auth = yield* AuthSettingsStore;

      expect(yield* SubscriptionRef.get(auth.settings)).toEqual({
        ...methods,
        gravatar: false,
        oidc,
      });
    }).pipe(Effect.provide(storedAs(mode)), Effect.runPromise),
  );
});
