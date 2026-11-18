import { expect, it } from "@effect/vitest";
import { Effect, Layer, SubscriptionRef } from "effect";
import { SqlClient } from "effect/sql";

import { defaultAuthSettings } from "@fleetfrog/protocol/domain/user";

import { ActivityStore } from "../../activity/activityStore.ts";
import { AuthSettingsStore } from "../../auth/authSettingsStore.ts";
import { testHubConfig } from "../../testHubConfig.ts";
import { upgradedTestDatabase } from "./upgradedTestDatabase.ts";

const MigratedDatabase = upgradedTestDatabase(
  "0010",
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
    })}`;
    yield* sql`insert into action_batches ${sql.insert({
      id: "dddddddd-0000-4000-8000-000000000000",
      kind: "Fetch",
      scope_json: JSON.stringify({ _tag: "All" }),
      requested_at: "2026-09-27T02:00:00.000Z",
      finished_at: "2026-09-27T02:00:05.000Z",
    })}`;
    yield* sql`insert into hub_events ${sql.insert({
      at: "2026-09-27T03:00:00.000Z",
      machine_id: null,
      event_json: JSON.stringify({
        _tag: "PollingChanged",
        polling: {
          idleStatusSeconds: 300,
          watchingStatusSeconds: 30,
          discoverySeconds: 1800,
          githubSeconds: 900,
        },
      }),
    })}`;
  }),
);

const TestStores = Layer.mergeAll(ActivityStore.layer, AuthSettingsStore.layer).pipe(
  Layer.provide(MigratedDatabase),
  Layer.provide(testHubConfig()),
);

it.effect(
  "reads history and settings from before sign-in, with sign-in off and no one recorded",
  () =>
    Effect.gen(function* () {
      const activity = yield* ActivityStore;
      const auth = yield* AuthSettingsStore;

      const page = yield* activity.activity({
        filter: { machineIds: [], repositoryKeys: [], outcomes: [] },
        limit: 10,
      });

      expect(
        page.entries.map((entry) =>
          entry._tag === "Batch" ? ["Batch", entry.batch.requestedBy] : ["Event", entry.by],
        ),
      ).toStrictEqual([
        ["Event", null],
        ["Batch", null],
      ]);
      expect(yield* SubscriptionRef.get(auth.settings)).toStrictEqual(defaultAuthSettings);
    }).pipe(Effect.provide(TestStores)),
);
