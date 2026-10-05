import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";

import { defaultPreferences, defaultProjectLayout } from "@fleetfrog/protocol/domain/preferences";
import { UserId } from "@fleetfrog/protocol/domain/user";

import { PreferencesStore } from "../../settings/preferencesStore.ts";
import { migrations } from "../database.ts";

const before = Object.fromEntries(Object.entries(migrations).filter(([name]) => name < "0014"));
const ada = UserId.make("0b8f6a52-7f9e-4c55-9a8e-2f4a1c9d3e10");

const Migrated = PreferencesStore.layer.pipe(
  Layer.provide(
    Layer.effectDiscard(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        yield* SqliteMigrator.run({ loader: SqliteMigrator.fromRecord(before) });
        yield* sql`insert into settings ${sql.insert({
          id: 1,
          polling_json: JSON.stringify({
            idleStatusSeconds: 300,
            watchingStatusSeconds: 30,
            discoverySeconds: 1800,
            githubSeconds: 900,
          }),
        })}`;
        yield* sql`insert into users ${sql.insert({
          id: ada,
          email: "ada@example.com",
          display_name: "Ada",
          role: "admin",
          password_hash: "unused",
          created_at: "2026-09-01T00:00:00.000Z",
        })}`;
        yield* SqliteMigrator.run({ loader: SqliteMigrator.fromRecord(migrations) });
      }),
    ),
  ),
  Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })),
);

const Fresh = PreferencesStore.layer.pipe(
  Layer.provide(SqliteMigrator.layer({ loader: SqliteMigrator.fromRecord(migrations) })),
  Layer.provide(SqliteClient.layer({ filename: ":memory:" })),
);

describe("0014_preferences", () => {
  it.effect("gives existing users and the open dashboard the defaults, then keeps each apart", () =>
    Effect.gen(function* () {
      const preferences = yield* PreferencesStore;

      const dark = {
        colorScheme: "dark",
        blurPersonal: true,
        projects: defaultProjectLayout,
      } as const;

      const light = { ...dark, colorScheme: "light", blurPersonal: false } as const;

      expect(yield* preferences.get(ada)).toEqual(defaultPreferences);
      expect(yield* preferences.get(null)).toEqual(defaultPreferences);

      yield* preferences.set(ada, dark);
      yield* preferences.set(null, light);

      expect(yield* preferences.get(ada)).toEqual(dark);
      expect(yield* preferences.get(null)).toEqual(light);
    }).pipe(Effect.provide(Migrated)),
  );

  it.effect("saves the open dashboard's preferences on a hub that hasn't saved settings", () =>
    Effect.gen(function* () {
      const preferences = yield* PreferencesStore;

      const dark = { ...defaultPreferences, colorScheme: "dark", blurPersonal: true } as const;

      yield* preferences.set(null, dark);

      expect(yield* preferences.get(null)).toEqual(dark);
    }).pipe(Effect.provide(Fresh)),
  );

  it.effect("reads preferences saved before project layouts with the default layout", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const preferences = yield* PreferencesStore;

      yield* sql`update users set preferences_json = ${JSON.stringify({ colorScheme: "dark", blurPersonal: true })} where id = ${ada}`;

      expect(yield* preferences.get(ada)).toEqual({
        colorScheme: "dark",
        blurPersonal: true,
        projects: defaultProjectLayout,
      });
    }).pipe(Effect.provide(Migrated)),
  );
});
