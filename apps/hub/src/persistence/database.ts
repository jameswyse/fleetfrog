import { mkdirSync } from "node:fs";
import path from "node:path";

import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { Effect, Layer, Schema } from "effect";

import { HubConfig } from "../hubConfig.ts";
import initial from "./migrations/0001_initial.ts";

const client = Layer.unwrap(
  Effect.gen(function* () {
    const { dataDirectory } = yield* HubConfig;

    mkdirSync(dataDirectory, { recursive: true });

    return SqliteClient.layer({ filename: path.join(dataDirectory, "fleetfrog.db") });
  }),
);

const migrations = SqliteMigrator.layer({
  loader: SqliteMigrator.fromRecord({ "0001_initial": initial }),
});

/** The hub's SQLite database, migrated to the latest schema. */
export const Database = migrations.pipe(Layer.provideMerge(client));

/** A text column holding a JSON document of the given schema. */
export function JsonColumn<S extends Schema.Top>(schema: S) {
  return Schema.fromJsonString(Schema.toCodecJson(schema));
}
