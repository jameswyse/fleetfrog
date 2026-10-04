import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export const machineKind = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`alter table machines add column custom_kind text`;
});
