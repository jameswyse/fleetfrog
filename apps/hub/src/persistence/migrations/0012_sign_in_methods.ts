import { Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";

const SingleMode = Schema.fromJsonString(
  Schema.Struct({
    mode: Schema.Literals(["none", "local", "oidc"]),
    gravatar: Schema.Boolean,
    oidc: Schema.Unknown,
  }),
);

const decodeSingleMode = Schema.decodeUnknownOption(SingleMode);

export const signInMethods = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const rows = yield* sql<{ readonly auth_json: string | null }>`
    select auth_json from settings where id = 1
  `;

  for (const { auth_json } of rows) {
    if (auth_json === null) {
      continue;
    }

    const stored = decodeSingleMode(auth_json);

    if (Option.isNone(stored)) {
      continue;
    }

    const { mode, gravatar, oidc } = stored.value;
    const migrated = { passwords: mode === "local", provider: mode === "oidc", gravatar, oidc };

    yield* sql`update settings set auth_json = ${JSON.stringify(migrated)} where id = 1`;
  }

  yield* sql`
    create table provider_icon (
      id integer primary key check (id = 1),
      hash text not null,
      media_type text not null,
      source text not null,
      data blob not null
    )
  `;
});
