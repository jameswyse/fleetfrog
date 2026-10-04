import { Context, Effect, Layer, Schema, SubscriptionRef } from "effect";
import { SqlClient } from "effect/sql";

import { defaultPollingSettings, PollingSettings } from "@fleetfrog/protocol/domain/polling";

import { JsonColumn } from "../persistence/database.ts";

const PollingJson = JsonColumn(PollingSettings);
const encodePolling = Schema.encodeSync(PollingJson);

const decodeRows = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ polling_json: PollingJson })),
);

export class PollingStore extends Context.Service<
  PollingStore,
  {
    readonly settings: SubscriptionRef.SubscriptionRef<PollingSettings>;
    readonly update: (polling: PollingSettings) => Effect.Effect<void>;
  }
>()("fleetfrog/PollingStore") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const [stored] = yield* sql`select polling_json from settings where id = 1`.pipe(
        Effect.flatMap(decodeRows),
        Effect.orDie,
      );

      const settings = yield* SubscriptionRef.make(stored?.polling_json ?? defaultPollingSettings);

      return {
        settings,
        update: (polling) =>
          sql`insert into settings ${sql.insert({ id: 1, polling_json: encodePolling(polling) })}
              on conflict (id) do update set polling_json = excluded.polling_json`.pipe(
            Effect.orDie,
            Effect.andThen(SubscriptionRef.set(settings, polling)),
          ),
      };
    }),
  );
}
