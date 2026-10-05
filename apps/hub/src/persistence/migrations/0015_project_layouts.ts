import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export const projectLayouts = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`alter table users add column project_layout_json text`;
  yield* sql`alter table users add column project_layout_revision integer not null default 0`;
  yield* sql`alter table settings add column open_project_layout_json text`;
  yield* sql`alter table settings add column open_project_layout_revision integer not null default 0`;

  yield* sql`update users
    set project_layout_json = json_extract(preferences_json, '$.projects'),
      preferences_json = json_remove(preferences_json, '$.projects')
    where json_type(preferences_json, '$.projects') = 'object'`;

  yield* sql`update settings
    set open_project_layout_json = json_extract(open_preferences_json, '$.projects'),
      open_preferences_json = json_remove(open_preferences_json, '$.projects')
    where json_type(open_preferences_json, '$.projects') = 'object'`;
});
