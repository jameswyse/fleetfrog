import { mkdirSync } from "node:fs";
import path from "node:path";

import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { Effect, Layer, Schema } from "effect";

import { HubConfig } from "../hubConfig.ts";
import initial from "./migrations/0001_initial.ts";
import actions from "./migrations/0002_actions.ts";

const client = Layer.unwrap(
  Effect.gen(function* () {
    const { dataDirectory } = yield* HubConfig;

    mkdirSync(dataDirectory, { recursive: true });

    return SqliteClient.layer({ filename: path.join(dataDirectory, "fleetfrog.db") });
  }),
);

/** Brings any SQLite database up to the latest schema. */
export const Migrations = SqliteMigrator.layer({
  loader: SqliteMigrator.fromRecord({ "0001_initial": initial, "0002_actions": actions }),
});

/** The hub's SQLite database, migrated to the latest schema. */
export const Database = Migrations.pipe(Layer.provideMerge(client));

/** A text column holding a JSON document of the given schema. */
export function JsonColumn<S extends Schema.Top>(schema: S) {
  return Schema.fromJsonString(Schema.toCodecJson(schema));
}
