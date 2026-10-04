import { Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";

const WithoutTailscale = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Unknown).check(
    Schema.makeFilter((settings) => !("tailscale" in settings)),
  ),
);

const decodeWithoutTailscale = Schema.decodeUnknownOption(WithoutTailscale);

export const tailscaleSignIn = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const rows = yield* sql<{ readonly auth_json: string | null }>`
    select auth_json from settings where id = 1
  `;

  for (const { auth_json } of rows) {
    const stored = decodeWithoutTailscale(auth_json);

    if (Option.isSome(stored)) {
      const migrated = { ...stored.value, tailscale: false };

      yield* sql`update settings set auth_json = ${JSON.stringify(migrated)} where id = 1`;
    }
  }

  yield* sql`alter table users add column tailscale_login text`;
  yield* sql`create unique index users_tailscale on users (tailscale_login)`;
});
