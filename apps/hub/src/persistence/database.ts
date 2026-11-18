import { mkdirSync } from "node:fs";
import path from "node:path";

import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { Effect, Layer, Schema } from "effect";

import { HubConfig } from "../hubConfig.ts";
import { migrations } from "./migrations/registry.ts";

const client = Layer.unwrap(
  Effect.gen(function* () {
    const { dataDirectory, demo } = yield* HubConfig;

    if (demo) {
      return SqliteClient.layer({ filename: ":memory:" });
    }

    mkdirSync(dataDirectory, { recursive: true });

    return SqliteClient.layer({ filename: path.join(dataDirectory, "fleetfrog.db") });
  }),
);

export const Migrations = SqliteMigrator.layer({ loader: SqliteMigrator.fromRecord(migrations) });

export const Database = Migrations.pipe(Layer.provideMerge(client));

export function JsonColumn<S extends Schema.Top>(schema: S) {
  return Schema.fromJsonString(Schema.toCodecJson(schema));
}
