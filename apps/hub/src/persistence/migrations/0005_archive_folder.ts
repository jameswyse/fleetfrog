import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export const archiveFolder = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`alter table settings add column archive_folder text`;
});
