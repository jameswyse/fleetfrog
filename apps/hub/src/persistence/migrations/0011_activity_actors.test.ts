import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { expect, it } from "@effect/vitest";
import { Effect, Layer, SubscriptionRef } from "effect";
import { SqlClient } from "effect/sql";

import { defaultAuthSettings } from "@fleetfrog/protocol/domain/user";

import { ActivityStore } from "../../activity/activityStore.ts";
import { AuthSettingsStore } from "../../auth/authSettingsStore.ts";
import { HubConfig } from "../../hubConfig.ts";
import { migrations } from "../database.ts";

const before = Object.fromEntries(Object.entries(migrations).filter(([name]) => name < "0010"));

/** A database from before sign-in holding settings, a batch and an event, then fully migrated. */
const OldDatabase = Layer.effectDiscard(
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
    yield* SqliteMigrator.run({ loader: SqliteMigrator.fromRecord(migrations) });
  }),
);

const TestStores = Layer.mergeAll(ActivityStore.layer, AuthSettingsStore.layer).pipe(
  Layer.provide(OldDatabase),
  Layer.provide(SqliteClient.layer({ filename: ":memory:" })),
  Layer.provide(
    Layer.succeed(HubConfig)({
      dataDirectory: "unused",
      host: null,
      dashboardPort: 7420,
      agentPort: 7421,
      agentTls: "self-signed",
      agentUrl: null,
      tailscaleSocket: null,
      dashboardSocket: null,
      webRoot: null,
      authModeOverride: null,
    }),
  ),
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
      ).toEqual([
        ["Event", null],
        ["Batch", null],
      ]);
      expect(yield* SubscriptionRef.get(auth.settings)).toEqual(defaultAuthSettings);
    }).pipe(Effect.provide(TestStores)),
);
