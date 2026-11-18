import { SqliteClient } from "@effect/sql-sqlite-node";
import { Layer } from "effect";

import { Migrations } from "./database.ts";

export const TestDatabase = Migrations.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })),
);
