import { Context, Effect, Layer, Schema, SubscriptionRef } from "effect";
import { SqlClient } from "effect/sql";

import { CleanupSettings, defaultCleanupSettings } from "@fleetfrog/protocol/domain/cleanup";
import { defaultPollingSettings, PollingSettings } from "@fleetfrog/protocol/domain/polling";

import { JsonColumn } from "../persistence/database.ts";

const CleanupJson = JsonColumn(CleanupSettings);
const encodeCleanup = Schema.encodeSync(CleanupJson);
const encodePolling = Schema.encodeSync(JsonColumn(PollingSettings));

const decodeRows = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ cleanup_json: Schema.NullOr(CleanupJson) })),
);

export class CleanupStore extends Context.Service<
  CleanupStore,
  {
    readonly settings: SubscriptionRef.SubscriptionRef<CleanupSettings>;
    readonly update: (cleanup: CleanupSettings) => Effect.Effect<void>;
  }
>()("fleetfrog/CleanupStore") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const [stored] = yield* sql`select cleanup_json from settings where id = 1`.pipe(
        Effect.flatMap(decodeRows),
        Effect.orDie,
      );

      const settings = yield* SubscriptionRef.make(stored?.cleanup_json ?? defaultCleanupSettings);

      return {
        settings,
        update: (cleanup) =>
          sql`insert into settings ${sql.insert({
            id: 1,
            polling_json: encodePolling(defaultPollingSettings),
            cleanup_json: encodeCleanup(cleanup),
          })} on conflict (id) do update set cleanup_json = excluded.cleanup_json`.pipe(
            Effect.orDie,
            Effect.andThen(SubscriptionRef.set(settings, cleanup)),
          ),
      };
    }),
  );
}
