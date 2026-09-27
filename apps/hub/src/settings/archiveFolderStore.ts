import { Context, Effect, Layer, Schema, SubscriptionRef } from "effect";
import { SqlClient } from "effect/unstable/sql";

import { defaultPollingSettings, PollingSettings } from "@fleetfrog/protocol/domain/polling";

import { JsonColumn } from "../persistence/database.ts";

const encodePolling = Schema.encodeSync(JsonColumn(PollingSettings));
const decodeRows = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ archive_folder: Schema.NullOr(Schema.String) })),
);

/** The hub-wide Archive folder, persisted and observable. Null while archiving is off. */
export class ArchiveFolderStore extends Context.Service<
  ArchiveFolderStore,
  {
    readonly folder: SubscriptionRef.SubscriptionRef<string | null>;
    readonly update: (folder: string | null) => Effect.Effect<void>;
  }
>()("fleetfrog/ArchiveFolderStore") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [stored] = yield* sql`select archive_folder from settings where id = 1`.pipe(
        Effect.flatMap(decodeRows),
        Effect.orDie,
      );
      const folder = yield* SubscriptionRef.make(stored?.archive_folder ?? null);

      return {
        folder,
        // The settings row may not exist yet, so a first save also stores the default polling.
        update: (next) =>
          sql`insert into settings ${sql.insert({
            id: 1,
            polling_json: encodePolling(defaultPollingSettings),
            archive_folder: next,
          })} on conflict (id) do update set archive_folder = excluded.archive_folder`.pipe(
            Effect.orDie,
            Effect.andThen(SubscriptionRef.set(folder, next)),
          ),
      };
    }),
  );
}
