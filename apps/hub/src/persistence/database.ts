import path from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { Effect, FileSystem, Layer, Schema } from "effect";

import { HubConfig } from "../hubConfig.ts";
import { migrations } from "./migrations/registry.ts";

const client = Layer.unwrap(
  Effect.gen(function* () {
    const { dataDirectory, demo } = yield* HubConfig;

    if (demo) {
      return SqliteClient.layer({ filename: ":memory:" });
    }

    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(dataDirectory, { recursive: true });

    return SqliteClient.layer({ filename: path.join(dataDirectory, "fleetfrog.db") });
  }),
).pipe(Layer.provide(NodeFileSystem.layer));

export const Migrations = SqliteMigrator.layer({ loader: SqliteMigrator.fromRecord(migrations) });

export const Database = Migrations.pipe(Layer.provideMerge(client));

export function JsonColumn<S extends Schema.Top>(schema: S) {
  return Schema.fromJsonString(Schema.toCodecJson(schema));
}
