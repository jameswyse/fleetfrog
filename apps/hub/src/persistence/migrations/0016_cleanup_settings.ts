import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export const cleanupSettings = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`alter table settings add column cleanup_json text`;
});
