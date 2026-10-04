import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export const users = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    create table users (
      id text primary key,
      email text not null unique,
      display_name text not null,
      role text not null,
      password_hash text,
      oidc_issuer text,
      oidc_subject text,
      provider_name text,
      provider_picture text,
      created_at text not null,
      last_signed_in_at text
    )
  `;
  yield* sql`create unique index users_oidc on users (oidc_issuer, oidc_subject)`;
  yield* sql`
    create table user_avatars (
      user_id text primary key,
      id text not null,
      media_type text not null,
      data blob not null
    )
  `;
  yield* sql`create index user_avatars_id on user_avatars (id)`;
  yield* sql`
    create table dashboard_sessions (
      token_hash text primary key,
      user_id text not null,
      created_at text not null,
      expires_at text not null
    )
  `;
  yield* sql`create index dashboard_sessions_user on dashboard_sessions (user_id)`;
  yield* sql`alter table settings add column auth_json text`;
});
