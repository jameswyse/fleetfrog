import { mkdirSync } from "node:fs";
import path from "node:path";

import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { Effect, Layer, Schema } from "effect";

import { HubConfig } from "../hubConfig.ts";
import initial from "./migrations/0001_initial.ts";
import actions from "./migrations/0002_actions.ts";
import machineUsage from "./migrations/0003_machine_usage.ts";
import machineKind from "./migrations/0004_machine_kind.ts";

const client = Layer.unwrap(
  Effect.gen(function* () {
    const { dataDirectory } = yield* HubConfig;

    mkdirSync(dataDirectory, { recursive: true });

    return SqliteClient.layer({ filename: path.join(dataDirectory, "fleetfrog.db") });
  }),
);

export const Migrations = SqliteMigrator.layer({
  loader: SqliteMigrator.fromRecord({
    "0001_initial": initial,
    "0002_actions": actions,
    "0003_machine_usage": machineUsage,
    "0004_machine_kind": machineKind,
  }),
});

export const Database = Migrations.pipe(Layer.provideMerge(client));

/** A text column holding a JSON document of the given schema. */
export function JsonColumn<S extends Schema.Top>(schema: S) {
  return Schema.fromJsonString(Schema.toCodecJson(schema));
}
