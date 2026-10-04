import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export const machineUsage = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`alter table machines add column usage_json text`;
});
