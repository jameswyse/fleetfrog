import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, SubscriptionRef } from "effect";
import { SqlClient } from "effect/sql";

import { defaultCleanupSettings } from "@fleetfrog/protocol/domain/cleanup";

import { CleanupStore } from "../../settings/cleanupStore.ts";
import { PollingStore } from "../../settings/pollingStore.ts";
import { migrations } from "../database.ts";

import type { PollingSettings } from "@fleetfrog/protocol/domain/polling";

const before = Object.fromEntries(Object.entries(migrations).filter(([name]) => name < "0016"));

const polling: PollingSettings = {
  idleStatusSeconds: 60,
  watchingStatusSeconds: 10,
  discoverySeconds: 600,
  githubSeconds: 300,
};

const migratedDatabase = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* SqliteMigrator.run({ loader: SqliteMigrator.fromRecord(before) });
    yield* sql`insert into settings ${sql.insert({ id: 1, polling_json: JSON.stringify(polling) })}`;
    yield* SqliteMigrator.run({ loader: SqliteMigrator.fromRecord(migrations) });
  }),
).pipe(Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })));

const Stores = Layer.merge(CleanupStore.layer, PollingStore.layer);

describe("0016_cleanup_settings", () => {
  it.effect("reads the default ignored branches from a database saved before the change", () =>
    Effect.gen(function* () {
      const cleanup = yield* CleanupStore;
      const stored = yield* PollingStore;

      expect(yield* SubscriptionRef.get(cleanup.settings)).toStrictEqual(defaultCleanupSettings);
      expect(yield* SubscriptionRef.get(stored.settings)).toStrictEqual(polling);
    }).pipe(Effect.provide(Stores.pipe(Layer.provideMerge(migratedDatabase)))),
  );

  it.effect("keeps an edited list and the polling settings when the hub restarts", () =>
    Effect.gen(function* () {
      const edited = { ignoredBranches: ["main", "release"] };

      yield* Effect.gen(function* () {
        const cleanup = yield* CleanupStore;

        yield* cleanup.update(edited);
      }).pipe(Effect.provide(CleanupStore.layer, { local: true }));

      const reloaded = yield* Effect.gen(function* () {
        const cleanup = yield* CleanupStore;
        const stored = yield* PollingStore;

        return {
          cleanup: yield* SubscriptionRef.get(cleanup.settings),
          polling: yield* SubscriptionRef.get(stored.settings),
        };
      }).pipe(Effect.provide(Stores, { local: true }));

      expect(reloaded).toStrictEqual({ cleanup: edited, polling });
    }).pipe(Effect.provide(migratedDatabase)),
  );
});
