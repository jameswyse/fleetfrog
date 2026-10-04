import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`alter table machines add column archive_folder text`;
  yield* sql`update machines set archive_folder = (select archive_folder from settings where id = 1)`;
  yield* sql`alter table settings drop column archive_folder`;
});
