import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`alter table users add column preferences_json text`;
  yield* sql`alter table settings add column open_preferences_json text`;
});
