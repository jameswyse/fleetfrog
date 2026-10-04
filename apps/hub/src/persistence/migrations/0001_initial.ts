import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export const initial = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    create table machines (
      id text primary key,
      token_hash text not null unique,
      info_json text not null,
      custom_name text,
      discovery_roots_json text not null,
      paired_at text not null,
      last_seen_at text,
      last_discovery_at text,
      last_status_at text
    )
  `;
  yield* sql`
    create table checkouts (
      machine_id text not null references machines (id) on delete cascade,
      path text not null,
      checkout_json text not null,
      primary key (machine_id, path)
    )
  `;
  yield* sql`
    create table settings (
      id integer primary key check (id = 1),
      polling_json text not null
    )
  `;
});
