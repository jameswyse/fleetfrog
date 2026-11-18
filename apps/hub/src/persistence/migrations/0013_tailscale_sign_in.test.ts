import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, SubscriptionRef } from "effect";
import { SqlClient } from "effect/sql";

import { AuthSettingsStore } from "../../auth/authSettingsStore.ts";
import { UserStore } from "../../auth/userStore.ts";
import { testHubConfig } from "../../testHubConfig.ts";
import { upgradedTestDatabase } from "./upgradedTestDatabase.ts";

const Migrated = UserStore.layer.pipe(
  Layer.provideMerge(AuthSettingsStore.layer),
  Layer.provide(
    upgradedTestDatabase(
      "0013",
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
          auth_json: JSON.stringify({
            passwords: true,
            provider: false,
            gravatar: true,
            oidc: null,
          }),
        })}`;
        yield* sql`insert into users ${sql.insert({
          id: "0b8f6a52-7f9e-4c55-9a8e-2f4a1c9d3e10",
          email: "ada@example.com",
          display_name: "Ada",
          role: "admin",
          password_hash: "unused",
          created_at: "2026-09-01T00:00:00.000Z",
        })}`;
      }),
    ),
  ),
  Layer.provide(testHubConfig()),
);

describe("0013_tailscale_sign_in", () => {
  it.effect("keeps sign-in as it was, with Tailscale off and users not linked to it", () =>
    Effect.gen(function* () {
      const auth = yield* AuthSettingsStore;
      const users = yield* UserStore;

      expect(yield* SubscriptionRef.get(auth.settings)).toStrictEqual({
        passwords: true,
        provider: false,
        tailscale: false,
        gravatar: true,
        oidc: null,
      });
      expect(yield* SubscriptionRef.get(users.records)).toMatchObject([
        { email: "ada@example.com", role: "admin", tailscaleLogin: null },
      ]);
    }).pipe(Effect.provide(Migrated)),
  );
});
