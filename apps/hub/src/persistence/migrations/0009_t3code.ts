import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

/** The T3 Code integration: each machine's last reading, its project icons and the settings. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`alter table machines add column t3code_json text`;
  yield* sql`
    create table project_icons (
      machine_id text not null,
      id text not null,
      media_type text not null,
      data blob not null,
      primary key (machine_id, id)
    )
  `;
  yield* sql`create index project_icons_id on project_icons (id)`;
  yield* sql`alter table settings add column integrations_json text`;
});
