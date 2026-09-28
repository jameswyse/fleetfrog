import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

/**
 * Each user's preferences, such as their colour scheme, and the preferences everyone shares while
 * sign-in is off. Null means the defaults, so existing users and hubs need no values.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`alter table users add column preferences_json text`;
  yield* sql`alter table settings add column open_preferences_json text`;
});
