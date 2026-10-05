import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";

import { defaultProjectLayout, ProjectGroupId } from "@fleetfrog/protocol/domain/projectLayout";
import { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";
import { UserId } from "@fleetfrog/protocol/domain/user";

import { PreferencesStore } from "../../settings/preferencesStore.ts";
import { ProjectLayoutStore } from "../../settings/projectLayoutStore.ts";
import { migrations } from "../database.ts";

import type { ProjectLayout } from "@fleetfrog/protocol/domain/projectLayout";

const before = Object.fromEntries(Object.entries(migrations).filter(([name]) => name < "0015"));
const ada = UserId.make("0b8f6a52-7f9e-4c55-9a8e-2f4a1c9d3e10");
const grace = UserId.make("1c8f6a52-7f9e-4c55-9a8e-2f4a1c9d3e10");
const shop = RepositoryKey.make("remote:github.com/acme/shop");

const adaLayout: ProjectLayout = {
  sort: "updated",
  groupByOwner: true,
  pinned: [shop],
  groups: [
    {
      id: ProjectGroupId.make("2d8f6a52-7f9e-4c55-9a8e-2f4a1c9d3e10"),
      name: "Work",
      repositories: [shop],
    },
  ],
  collapsed: ["pinned"],
};

const Stores = Layer.merge(PreferencesStore.layer, ProjectLayoutStore.layer);

const user = (id: UserId, email: string, preferences: unknown) => ({
  id,
  email,
  display_name: email,
  role: "admin",
  password_hash: "unused",
  created_at: "2026-09-01T00:00:00.000Z",
  preferences_json: preferences === null ? null : JSON.stringify(preferences),
});

const Migrated = Stores.pipe(
  Layer.provide(
    Layer.effectDiscard(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        yield* SqliteMigrator.run({ loader: SqliteMigrator.fromRecord(before) });
        yield* sql`insert into users ${sql.insert(
          user(ada, "ada@example.com", {
            colorScheme: "dark",
            blurPersonal: true,
            projects: adaLayout,
          }),
        )}`;
        yield* sql`insert into users ${sql.insert(
          user(grace, "grace@example.com", { colorScheme: "light", blurPersonal: false }),
        )}`;
        yield* SqliteMigrator.run({ loader: SqliteMigrator.fromRecord(migrations) });
      }),
    ),
  ),
  Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })),
);

const Fresh = Stores.pipe(
  Layer.provide(SqliteMigrator.layer({ loader: SqliteMigrator.fromRecord(migrations) })),
  Layer.provide(SqliteClient.layer({ filename: ":memory:" })),
);

describe("0015_project_layouts", () => {
  it.effect("moves a layout saved with the preferences into its own column", () =>
    Effect.gen(function* () {
      const layouts = yield* ProjectLayoutStore;
      const preferences = yield* PreferencesStore;
      const sql = yield* SqlClient.SqlClient;

      expect(yield* layouts.get(ada)).toEqual({ layout: adaLayout, revision: 0 });
      expect(yield* layouts.get(grace)).toEqual({ layout: defaultProjectLayout, revision: 0 });
      expect(yield* preferences.get(ada)).toEqual({ colorScheme: "dark", blurPersonal: true });

      const [row] = yield* sql<{
        readonly preferences: string;
      }>`select preferences_json as preferences from users where id = ${ada}`;

      expect(row?.preferences).not.toContain("projects");
    }).pipe(Effect.provide(Migrated)),
  );

  it.effect("refuses a save based on an older revision and returns the current layout", () =>
    Effect.gen(function* () {
      const layouts = yield* ProjectLayoutStore;
      const pinned = { ...defaultProjectLayout, pinned: [shop] };

      expect(yield* layouts.save(null, pinned, 0)).toBe(1);

      const conflict = yield* layouts.save(null, defaultProjectLayout, 0).pipe(Effect.flip);

      expect(conflict.current).toEqual({ layout: pinned, revision: 1 });
      expect(yield* layouts.get(null)).toEqual({ layout: pinned, revision: 1 });
    }).pipe(Effect.provide(Fresh)),
  );
});
