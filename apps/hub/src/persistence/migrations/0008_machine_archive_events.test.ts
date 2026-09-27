import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql";

import { ActivityStore } from "../../activity/activityStore.ts";
import { migrations } from "../database.ts";

const { "0008_machine_archive_events": _, ...before } = migrations;

/** A database from before 0008 holding a hub-wide Archive folder change, then fully migrated. */
const OldDatabase = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const machine = (id: string, pairedAt: string, prettyName: string) => ({
      id,
      token_hash: id,
      info_json: JSON.stringify({ hostname: `${id}.local`, prettyName }),
      discovery_roots_json: "[]",
      paired_at: pairedAt,
    });

    yield* SqliteMigrator.run({ loader: SqliteMigrator.fromRecord(before) });
    yield* sql`insert into machines ${sql.insert([
      machine("aaaaaaaa-0000-4000-8000-000000000000", "2026-09-26T09:00:00.000Z", "Studio"),
      machine("bbbbbbbb-0000-4000-8000-000000000000", "2026-09-27T04:00:00.000Z", "Laptop"),
    ])}`;
    yield* sql`insert into hub_events ${sql.insert({
      at: "2026-09-27T02:57:12.876Z",
      machine_id: null,
      event_json: JSON.stringify({ _tag: "ArchiveFolderChanged", folder: "~/Projects/Archive" }),
    })}`;
    yield* SqliteMigrator.run({ loader: SqliteMigrator.fromRecord(migrations) });
  }),
);

const TestStore = ActivityStore.layer.pipe(
  Layer.provide(OldDatabase),
  Layer.provide(SqliteClient.layer({ filename: ":memory:" })),
);

it.effect("gives each machine paired at the time its own hub-wide Archive folder change", () =>
  Effect.gen(function* () {
    const store = yield* ActivityStore;
    const page = yield* store.activity({
      filter: { machineIds: [], repositoryKeys: [], outcomes: [] },
      limit: 10,
    });

    expect(page.entries.map((entry) => (entry._tag === "Event" ? entry.event : entry))).toEqual([
      {
        _tag: "ArchiveFolderChanged",
        machineId: "aaaaaaaa-0000-4000-8000-000000000000",
        machineName: "Studio",
        folder: "~/Projects/Archive",
      },
    ]);
  }).pipe(Effect.provide(TestStore)),
);
