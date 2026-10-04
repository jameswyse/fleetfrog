import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export const machineTrash = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`alter table machines add column trash_json text not null default '[]'`;
});
