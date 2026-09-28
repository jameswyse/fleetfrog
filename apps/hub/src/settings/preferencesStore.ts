import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql";

import { defaultPollingSettings, PollingSettings } from "@fleetfrog/protocol/domain/polling";
import { defaultPreferences, Preferences } from "@fleetfrog/protocol/domain/preferences";

import { JsonColumn } from "../persistence/database.ts";

import type { UserId } from "@fleetfrog/protocol/domain/user";

const PreferencesJson = JsonColumn(Preferences);
const encodePreferences = Schema.encodeSync(PreferencesJson);
const encodePolling = Schema.encodeSync(JsonColumn(PollingSettings));
const decodeRows = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ preferences: Schema.NullOr(PreferencesJson) })),
);

/**
 * Each user's preferences in their row, and those everyone shares while sign-in is off in the
 * settings row. A user or hub that never saved any has the defaults.
 */
export class PreferencesStore extends Context.Service<
  PreferencesStore,
  {
    /** The user's preferences, or with null everyone's while sign-in is off. */
    readonly get: (userId: UserId | null) => Effect.Effect<Preferences>;
    readonly set: (userId: UserId | null, preferences: Preferences) => Effect.Effect<void>;
  }
>()("fleetfrog/PreferencesStore") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      return {
        get: (userId) =>
          (userId === null
            ? sql`select open_preferences_json as preferences from settings where id = 1`
            : sql`select preferences_json as preferences from users where id = ${userId}`
          ).pipe(
            Effect.flatMap(decodeRows),
            Effect.map(([row]) => row?.preferences ?? defaultPreferences),
            Effect.orDie,
          ),
        set: (userId, preferences) =>
          (userId === null
            ? // The settings row may not exist yet, and it needs polling intervals to be created.
              sql`insert into settings ${sql.insert({
                id: 1,
                polling_json: encodePolling(defaultPollingSettings),
                open_preferences_json: encodePreferences(preferences),
              })} on conflict (id) do update set open_preferences_json = excluded.open_preferences_json`
            : sql`update users set preferences_json = ${encodePreferences(preferences)} where id = ${userId}`
          ).pipe(Effect.orDie, Effect.asVoid),
      };
    }),
  );
}
