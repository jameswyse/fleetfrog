import { mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { TestClock } from "effect/testing";

import { temporaryDirectory } from "../testing/temporaryDirectory.ts";
import { defaultMonogram, readT3Code } from "./readT3Code.ts";

/** The part of T3 Code's schema FleetFrog reads, at migration 54. */
function createDatabase(file: string, options: { readonly withoutColumn?: string } = {}) {
  const database = new DatabaseSync(file);

  const columns = (list: ReadonlyArray<string>) =>
    list.filter((column) => column !== options.withoutColumn).join(", ");

  database.exec(`
    pragma journal_mode = wal;
    create table effect_sql_migrations (migration_id integer primary key, created_at text, name text);
    insert into effect_sql_migrations values
      (53, '2026-09-17', 'PullRequestFilesViewed'),
      (54, '2026-09-25', 'ProjectionThreadsAutoSettleDisabledAt');
    create table projection_projects (${columns([
      "project_id text primary key",
      "title text",
      "workspace_root text",
      "project_icon_json text",
      "favicon_path text",
      "auto_pull integer",
      "updated_at text",
      "deleted_at text",
    ])});
    create table projection_threads (${columns([
      "thread_id text primary key",
      "project_id text",
      "title text",
      "worktree_path text",
      "archived_at text",
      "deleted_at text",
      "updated_at text",
      "pending_approval_count integer",
      "pending_user_input_count integer",
    ])});
    create table projection_thread_sessions (thread_id text primary key, status text, active_turn_id text);
  `);

  return database;
}

function createV2Database(file: string) {
  const database = new DatabaseSync(file);

  database.exec(`
    pragma journal_mode = wal;
    create table effect_sql_migrations (migration_id integer primary key, created_at text, name text);
    insert into effect_sql_migrations values
      (55, '2026-10-03', 'OrchestrationV2'),
      (56, '2026-10-03', 'RemoveRedundantProjectionIndexes');
    create table projection_projects (project_id text primary key, title text, workspace_root text,
      project_icon_json text, favicon_path text, auto_pull integer, updated_at text, deleted_at text);
    create table orchestration_v2_projection_threads (thread_id text primary key, project_id text,
      title text, payload_json text, archived_at text, deleted_at text, updated_at text);
    create table orchestration_v2_projection_runs (run_id text primary key, thread_id text, status text);
    create table orchestration_v2_projection_runtime_requests (runtime_request_id text primary key,
      thread_id text, kind text, status text);
  `);

  return database;
}

const readIn = (home: string, file = "state.sqlite") =>
  readT3Code({
    database: path.join(home, file),
    projectIcons: true,
    favicons: new Map(),
  });

/** When the tests read, so which idle threads count as recent doesn't depend on today's date. */
const now = Date.parse("2026-09-27T00:00:00.000Z");

/** The SHA-256 of `<svg/>`, the icon the tests write. */
const svgHash = "d4dc56669143034f31aa309635d4113d9ad76a02b1739da22c965ed2049be9e6";

describe("defaultMonogram", () => {
  it("matches the monograms T3 Code draws for projects without icons", () => {
    expect(["Agent Skills", "jameswyse", "web3 app", "!!!"].map(defaultMonogram)).toEqual([
      { _tag: "Monogram", text: "AS", color: "lime" },
      { _tag: "Monogram", text: "JE", color: "gray" },
      { _tag: "Monogram", text: "W3", color: "orange" },
      { _tag: "Monogram", text: "PR", color: "cyan" },
    ]);
  });
});

describe("readT3Code", () => {
  it.effect("reads projects with their icons and threads with what their agents are doing", () =>
    Effect.gen(function* () {
      const home = yield* temporaryDirectory("fleetfrog-t3code-");
      const shop = path.join(home, "shop");
      const site = path.join(home, "site");
      const worktree = path.join(home, "worktrees", "shop-fix");
      const database = createDatabase(path.join(home, "state.sqlite"));

      yield* TestClock.setTime(now);
      mkdirSync(path.join(site, "public"), { recursive: true });
      mkdirSync(shop);
      mkdirSync(worktree, { recursive: true });
      writeFileSync(path.join(site, "public", "favicon.svg"), "<svg/>");
      database.exec(`
        insert into projection_projects values
          ('p1', 'Shop', '${shop}', '{"kind":"lucide","name":"sparkles","color":"amber"}', null, 1, '2026-09-26T01:00:00.000Z', null),
          ('p2', 'Site', '${site}', null, null, 0, '2026-09-26T02:00:00.000Z', null),
          ('p3', 'Gone', '${home}/gone', null, null, 0, '2026-09-26T03:00:00.000Z', '2026-09-26T04:00:00.000Z'),
          ('p4', 'Agent Skills', '${home}/skills', null, null, 0, '2026-09-26T03:00:00.000Z', null);
        insert into projection_threads values
          ('t1', 'p1', 'Fix checkout', '${worktree}', null, null, '2026-09-26T05:00:00.000Z', 0, 0),
          ('t2', 'p1', 'Ask first', null, null, null, '2026-09-26T06:00:00.000Z', 1, 0),
          ('t3', 'p2', 'Done', null, null, null, '2026-09-26T04:00:00.000Z', 0, 0),
          ('t4', 'p2', 'Archived', null, '2026-09-26T07:00:00.000Z', null, '2026-09-26T07:00:00.000Z', 0, 0),
          ('t5', 'p3', 'In a deleted project', null, null, null, '2026-09-26T08:00:00.000Z', 0, 0),
          ('t6', 'p2', 'Long finished', null, null, null, '2026-08-01T00:00:00.000Z', 0, 0);
        insert into projection_thread_sessions values
          ('t1', 'running', 'turn-1'),
          ('t3', 'stopped', null);
      `);
      database.close();

      const { status, icons } = yield* readIn(home);

      expect(status.reading._tag).toBe("Read");

      if (status.reading._tag !== "Read") {
        return;
      }

      expect(status.reading.schema).toEqual({
        migration: 54,
        name: "ProjectionThreadsAutoSettleDisabledAt",
      });
      expect(
        status.reading.projects.map(({ title, path: folder, icon, autoPull }) => ({
          title,
          folder,
          icon,
          autoPull,
        })),
      ).toEqual([
        {
          title: "Shop",
          folder: shop,
          icon: { _tag: "Lucide", name: "sparkles", color: "amber" },
          autoPull: true,
        },
        { title: "Site", folder: site, icon: { _tag: "Image", id: svgHash }, autoPull: false },
        {
          title: "Agent Skills",
          folder: path.join(home, "skills"),
          icon: { _tag: "Monogram", text: "AS", color: "lime" },
          autoPull: false,
        },
      ]);
      expect(icons).toEqual([
        {
          id: svgHash,
          mediaType: "image/svg+xml",
          base64: Buffer.from("<svg/>").toString("base64"),
        },
      ]);
      // Newest first, without the archived thread that has no worktree, the deleted project's, or
      // the idle one from months ago, which still counts.
      expect(
        status.reading.threads.map(({ title, path: folder, worktree: own, state }) => ({
          title,
          folder,
          own,
          state,
        })),
      ).toEqual([
        { title: "Ask first", folder: shop, own: false, state: "Waiting" },
        { title: "Fix checkout", folder: worktree, own: true, state: "Working" },
        { title: "Done", folder: site, own: false, state: "Idle" },
      ]);
      expect(status.reading.threadCount).toBe(4);
      expect(status.reading.unreadRecords).toBe(0);
    }),
  );

  it.effect("reads threads from the database T3 Code moved them to at migration 55", () =>
    Effect.gen(function* () {
      const home = yield* temporaryDirectory("fleetfrog-t3code-");
      const shop = path.join(home, "shop");
      const worktree = path.join(home, "worktrees", "shop-fix");
      const database = createV2Database(path.join(home, "statev2.sqlite"));
      const payload = (worktreePath: string | null) => JSON.stringify({ worktreePath });

      yield* TestClock.setTime(now);
      mkdirSync(worktree, { recursive: true });
      mkdirSync(shop);
      database.exec(`
        insert into projection_projects values
          ('p1', 'Shop', '${shop}', null, null, 0, '2026-09-26T01:00:00.000Z', null);
        insert into orchestration_v2_projection_threads values
          ('t1', 'p1', 'Fix checkout', '${payload(worktree)}', null, null, '2026-09-26T05:00:00.000Z'),
          ('t2', 'p1', 'Ask first', '${payload(null)}', null, null, '2026-09-26T06:00:00.000Z'),
          ('t3', 'p1', 'Signed out', '${payload(null)}', null, null, '2026-09-26T04:00:00.000Z'),
          ('t4', 'p1', 'Wrapping up', '${payload(null)}', null, null, '2026-09-26T03:00:00.000Z'),
          ('t5', 'p1', 'Archived', '${payload(null)}', '2026-09-26T07:00:00.000Z', null, '2026-09-26T07:00:00.000Z'),
          ('t6', 'p1', 'Deleted', '${payload(null)}', null, '2026-09-26T08:00:00.000Z', '2026-09-26T08:00:00.000Z'),
          ('t7', 'p1', 'Changed shape', '{}', null, null, '2026-09-26T09:00:00.000Z');
        insert into orchestration_v2_projection_runs values
          ('r1', 't1', 'running'),
          ('r2', 't2', 'completed'),
          ('r3', 't3', 'completed'),
          ('r4', 't4', 'waiting');
        insert into orchestration_v2_projection_runtime_requests values
          ('q1', 't2', 'user_input', 'pending'),
          ('q2', 't3', 'auth_refresh', 'pending'),
          ('q3', 't1', 'permission', 'resolved');
      `);
      database.close();

      const { status } = yield* readIn(home, "statev2.sqlite");

      expect(status.reading._tag).toBe("Read");

      if (status.reading._tag !== "Read") {
        return;
      }

      expect(status.reading.schema).toEqual({
        migration: 56,
        name: "RemoveRedundantProjectionIndexes",
      });
      expect(
        status.reading.threads.map(({ title, path: folder, worktree: own, state }) => ({
          title,
          folder,
          own,
          state,
        })),
      ).toEqual([
        { title: "Ask first", folder: shop, own: false, state: "Waiting" },
        { title: "Fix checkout", folder: worktree, own: true, state: "Working" },
        { title: "Signed out", folder: shop, own: false, state: "Idle" },
        { title: "Wrapping up", folder: shop, own: false, state: "Working" },
      ]);
      expect(status.reading.threadCount).toBe(4);
      expect(status.reading.unreadRecords).toBe(1);
    }),
  );

  it.effect("names what's missing from a schema it can't read, with the schema's version", () =>
    Effect.gen(function* () {
      const home = yield* temporaryDirectory("fleetfrog-t3code-");

      createDatabase(path.join(home, "state.sqlite"), {
        withoutColumn: "worktree_path text",
      }).close();

      const { status } = yield* readIn(home);

      expect(status.reading._tag).toBe("Unreadable");

      if (status.reading._tag === "Unreadable") {
        expect(status.reading.message).toContain("projection_threads.worktree_path");
        expect(status.reading.schema).toEqual({
          migration: 54,
          name: "ProjectionThreadsAutoSettleDisabledAt",
        });
      }
    }),
  );

  it.effect("won't follow a favicon linked to a file outside the project's folder", () =>
    Effect.gen(function* () {
      const home = yield* temporaryDirectory("fleetfrog-t3code-");
      const site = path.join(home, "site");
      const secret = path.join(home, "id_ed25519.svg");
      const database = createDatabase(path.join(home, "state.sqlite"));

      mkdirSync(site);
      writeFileSync(secret, "PRIVATE KEY");
      symlinkSync(secret, path.join(site, "favicon.svg"));
      database.exec(`
        insert into projection_projects values
          ('p1', 'Site', '${site}', null, null, 0, '2026-09-26T01:00:00.000Z', null);
      `);
      database.close();

      const { status, icons } = yield* readIn(home);

      expect(icons).toEqual([]);
      const icon = status.reading._tag === "Read" ? status.reading.projects[0]?.icon : undefined;

      expect(icon?._tag === "Monogram" && icon.text).toBe("SE");
    }),
  );

  it.effect("counts records stored in a form it can't read, and reads the rest", () =>
    Effect.gen(function* () {
      const home = yield* temporaryDirectory("fleetfrog-t3code-");
      const database = createDatabase(path.join(home, "state.sqlite"));

      database.exec(`
        insert into projection_projects values
          ('p1', 'Shop', '${home}', '{"kind":"lucide","name":"store","color":"ultraviolet"}', null, 0, '2026-09-26T01:00:00.000Z', null),
          ('p2', 'Broken', '${home}', null, null, 0, 'not a date', null);
      `);
      database.close();

      const { status } = yield* readIn(home);

      expect(
        status.reading._tag === "Read" && status.reading.projects.map(({ title }) => title),
      ).toEqual(["Shop"]);
      expect(status.reading._tag === "Read" && status.reading.unreadRecords).toBe(2);
    }),
  );

  it.effect("finds nothing, and creates nothing, where T3 Code isn't installed", () =>
    Effect.gen(function* () {
      const home = yield* temporaryDirectory("fleetfrog-t3code-");
      const { status } = yield* readIn(home);

      expect(status.reading).toEqual({ _tag: "NotFound" });
      expect(readdirSync(home)).toEqual([]);
    }),
  );
});
