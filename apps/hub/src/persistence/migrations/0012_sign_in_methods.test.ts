import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, SubscriptionRef } from "effect";
import { SqlClient } from "effect/sql";

import { AuthSettingsStore } from "../../auth/authSettingsStore.ts";
import { testHubConfig } from "../../testHubConfig.ts";
import { upgradedTestDatabase } from "./upgradedTestDatabase.ts";

const oidc = {
  providerName: "Authentik",
  issuerUrl: "https://auth.example.com/application/o/fleetfrog/",
  clientId: "fleetfrog",
  clientSecret: "s3cret",
  dashboardUrl: "https://fleetfrog.example.com",
  adminGroup: "fleetfrog-admins",
  requiredGroup: null,
};

const storedAs = (mode: "none" | "local" | "oidc") =>
  AuthSettingsStore.layer.pipe(
    Layer.provide(
      upgradedTestDatabase(
        "0012",
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;

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
        }),
      ),
    ),
    Layer.provide(testHubConfig()),
  );

const switchesByMode = [
  ["none", { passwords: false, provider: false }],
  ["local", { passwords: true, provider: false }],
  ["oidc", { passwords: false, provider: true }],
] as const;

describe("0012_sign_in_methods", () => {
  for (const [mode, methods] of switchesByMode) {
    it.effect(`turns the ${mode} mode into its own switches, keeping the rest`, () =>
      Effect.gen(function* () {
        const auth = yield* AuthSettingsStore;

        expect(yield* SubscriptionRef.get(auth.settings)).toStrictEqual({
          ...methods,
          tailscale: false,
          gravatar: false,
          oidc,
        });
      }).pipe(Effect.provide(storedAs(mode))),
    );
  }
});
