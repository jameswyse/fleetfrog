import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { Effect, Layer } from "effect";

import { migrations } from "./registry.ts";

import type { SqlClient } from "effect/sql";

export function upgradedTestDatabase<E>(
  firstNewMigration: string,
  seedOldSchema: Effect.Effect<void, E, SqlClient.SqlClient>,
) {
  const oldMigrations = Object.fromEntries(
    Object.entries(migrations).filter(([name]) => name < firstNewMigration),
  );

  return Layer.effectDiscard(
    Effect.gen(function* () {
      yield* SqliteMigrator.run({ loader: SqliteMigrator.fromRecord(oldMigrations) });
      yield* seedOldSchema;
      yield* SqliteMigrator.run({ loader: SqliteMigrator.fromRecord(migrations) });
    }),
  ).pipe(Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })));
}
