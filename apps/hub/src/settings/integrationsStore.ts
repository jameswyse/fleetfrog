import { Context, Effect, Layer, Schema, SubscriptionRef } from "effect";
import { SqlClient } from "effect/unstable/sql";

import { defaultPollingSettings, PollingSettings } from "@fleetfrog/protocol/domain/polling";
import { defaultIntegrationSettings, IntegrationSettings } from "@fleetfrog/protocol/domain/t3Code";

import { JsonColumn } from "../persistence/database.ts";

const IntegrationsJson = JsonColumn(IntegrationSettings);
const encodeIntegrations = Schema.encodeSync(IntegrationsJson);
const encodePolling = Schema.encodeSync(JsonColumn(PollingSettings));
const decodeRows = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ integrations_json: Schema.NullOr(IntegrationsJson) })),
);

/** Hub-wide settings for other apps FleetFrog reads, persisted and observable. */
export class IntegrationsStore extends Context.Service<
  IntegrationsStore,
  {
    readonly settings: SubscriptionRef.SubscriptionRef<IntegrationSettings>;
    readonly update: (integrations: IntegrationSettings) => Effect.Effect<void>;
  }
>()("fleetfrog/IntegrationsStore") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [stored] = yield* sql`select integrations_json from settings where id = 1`.pipe(
        Effect.flatMap(decodeRows),
        Effect.orDie,
      );
      const settings = yield* SubscriptionRef.make(
        stored?.integrations_json ?? defaultIntegrationSettings,
      );

      return {
        settings,
        // The settings row may not exist yet, and it needs polling intervals to be created.
        update: (integrations) =>
          sql`insert into settings ${sql.insert({
            id: 1,
            polling_json: encodePolling(defaultPollingSettings),
            integrations_json: encodeIntegrations(integrations),
          })} on conflict (id) do update set integrations_json = excluded.integrations_json`.pipe(
            Effect.orDie,
            Effect.andThen(SubscriptionRef.set(settings, integrations)),
          ),
      };
    }),
  );
}
