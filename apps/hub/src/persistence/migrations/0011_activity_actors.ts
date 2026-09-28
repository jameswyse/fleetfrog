import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

/** Who started each batch and made each change, which stays null from before sign-in. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`alter table action_batches add column requested_by_json text`;
  yield* sql`alter table hub_events add column actor_json text`;
});
