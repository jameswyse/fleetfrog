import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

/** The Archive folder moves from one hub-wide setting to each machine, which keeps its value. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`alter table machines add column archive_folder text`;
  yield* sql`update machines set archive_folder = (select archive_folder from settings where id = 1)`;
  yield* sql`alter table settings drop column archive_folder`;
});
