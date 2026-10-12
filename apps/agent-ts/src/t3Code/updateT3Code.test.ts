import { writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";

import { runningT3CodeServer } from "../testing/t3CodeServer.ts";
import { temporaryDirectory } from "../testing/temporaryDirectory.ts";
import { makeT3CodeUpdater } from "./updateT3Code.ts";

import type { T3CodeUpdateOutcome } from "@fleetfrog/protocol/domain/t3CodeUpdate";

import type { AuditEntry } from "../audit/auditLog.ts";
import type { ConfigUnavailable } from "../config/agentConfig.ts";
import type { AgentPolicy } from "../config/agentPolicy.ts";
import type { T3CodeUpdateSession } from "./updateT3Code.ts";

const allowed: AgentPolicy = { allowedTiers: ["git", "cleanup", "update", "t3code"] };

function createDatabase(file: string, workingThreads: number) {
  const database = new DatabaseSync(file);

  database.exec(`
    create table effect_sql_migrations (migration_id integer primary key, created_at text, name text);
    insert into effect_sql_migrations values (54, '2026-09-25', 'ProjectionThreadsAutoSettleDisabledAt');
    create table projection_projects (project_id text primary key, title text, workspace_root text,
      project_icon_json text, favicon_path text, auto_pull integer, updated_at text, deleted_at text);
    create table projection_threads (thread_id text primary key, project_id text, title text,
      worktree_path text, archived_at text, deleted_at text, updated_at text,
      pending_approval_count integer, pending_user_input_count integer);
    create table projection_thread_sessions (thread_id text primary key, status text, active_turn_id text);
    insert into projection_projects values
      ('project', 'FleetFrog', '${path.dirname(file)}', null, null, 0, '2026-10-13T00:00:00.000Z', null);
  `);

  for (let index = 0; index < workingThreads; index += 1) {
    database.exec(`
      insert into projection_threads values ('thread-${index}', 'project', 'Thread ${index}', null,
        null, null, '2026-10-13T00:00:00.000Z', 0, 0);
      insert into projection_thread_sessions values ('thread-${index}', 'running', null);
    `);
  }

  database.close();
}

const setUp = (options: { readonly loadPolicy?: Effect.Effect<AgentPolicy, ConfigUnavailable> }) =>
  Effect.gen(function* () {
    const userdata = yield* temporaryDirectory("fleetfrog-t3update-");
    const database = path.join(userdata, "state.sqlite");
    const audit: Array<AuditEntry> = [];

    const updater = makeT3CodeUpdater({
      database: () => database,
      loadPolicy: options.loadPolicy ?? Effect.succeed(allowed),
      audit: (entry) => Effect.sync(() => audit.push(entry)),
    });

    const session = () => {
      const reports: Array<{ version: string; outcome: T3CodeUpdateOutcome }> = [];
      let open = true;
      let rescans = 0;

      const hub: T3CodeUpdateSession = {
        open: () => open,
        report: (version, outcome) => Effect.sync(() => reports.push({ version, outcome })),
        rescan: Effect.sync(() => {
          rescans += 1;
        }),
      };

      return {
        reports,
        rescans: () => rescans,
        close: () => {
          open = false;
        },
        update: (version: string) => updater.update(version, hub),
      };
    };

    const { reports, rescans, update } = session();

    return { userdata, database, audit, session, reports, rescans, update };
  });

const failedWith = (message: string) => [
  { version: "0.0.47", outcome: { _tag: "Failed", message } },
];

describe("makeT3CodeUpdater", () => {
  it.effect("refuses when the machine's owner hasn't allowed T3 Code updates", () =>
    Effect.gen(function* () {
      const { userdata, reports, audit, rescans, update } = yield* setUp({
        loadPolicy: Effect.succeed({ allowedTiers: ["git"] }),
      });

      yield* runningT3CodeServer(userdata, true);
      yield* update("0.0.47");

      expect(reports).toEqual(
        failedWith(
          "This machine's owner hasn't allowed T3 Code updates from the hub. Run fleetfrog allow t3code on it.",
        ),
      );
      expect(audit).toEqual([]);
      expect(rescans()).toBe(0);
    }),
  );

  it.effect("refuses when T3 Code's server isn't running", () =>
    Effect.gen(function* () {
      const { reports, update } = yield* setUp({});

      yield* update("0.0.47");

      expect(reports).toEqual(failedWith("T3 Code's server isn't running."));
    }),
  );

  it.effect("leaves T3 Code's desktop app to update itself", () =>
    Effect.gen(function* () {
      const { userdata, reports, update } = yield* setUp({});

      yield* runningT3CodeServer(userdata);
      yield* update("0.0.47");

      expect(reports).toEqual(
        failedWith("T3 Code runs in its desktop app on this machine, which updates itself."),
      );
    }),
  );

  it.effect("refuses when it can't read all of T3 Code's database", () =>
    Effect.gen(function* () {
      const missing = yield* setUp({});

      yield* runningT3CodeServer(missing.userdata, true);
      yield* missing.update("0.0.47");

      const unreadable = yield* setUp({});

      yield* runningT3CodeServer(unreadable.userdata, true);
      writeFileSync(unreadable.database, "not a database");
      yield* unreadable.update("0.0.47");

      const partial = yield* setUp({});

      yield* runningT3CodeServer(partial.userdata, true);
      createDatabase(partial.database, 0);

      const database = new DatabaseSync(partial.database);

      database.exec(`
        insert into projection_threads values ('garbled', 'project', 'Garbled', null, null, null,
          'not a date', 0, 0);
        insert into projection_thread_sessions values ('garbled', 'running', null);
      `);
      database.close();
      yield* partial.update("0.0.47");

      const refusal = failedWith(
        "FleetFrog can't read all of T3 Code's database here, so it can't tell whether a thread is running. Update T3 Code on the machine itself.",
      );

      expect([...missing.reports, ...unreadable.reports, ...partial.reports]).toEqual([
        ...refusal,
        ...refusal,
        ...refusal,
      ]);
    }),
  );

  it.effect("waits for T3 Code's working threads to finish", () =>
    Effect.gen(function* () {
      const one = yield* setUp({});

      yield* runningT3CodeServer(one.userdata, true);
      createDatabase(one.database, 1);
      yield* one.update("0.0.47");

      const two = yield* setUp({});

      yield* runningT3CodeServer(two.userdata, true);
      createDatabase(two.database, 2);
      yield* two.update("0.0.47");

      expect([...one.reports, ...two.reports]).toEqual([
        ...failedWith("T3 Code is running 1 thread. Try again when it finishes."),
        ...failedWith("T3 Code is running 2 threads. Try again when they finish."),
      ]);
    }),
  );

  it.effect("reports a failed updater with the end of its output", () =>
    Effect.gen(function* () {
      const { userdata, database, reports, audit, rescans, update } = yield* setUp({});

      yield* runningT3CodeServer(userdata, true);
      createDatabase(database, 0);
      yield* update("0.0.47");

      const [report] = reports;

      expect(report?.outcome._tag === "Failed" ? report.outcome.message : null).toMatch(
        /^T3 Code's updater exited with code 1\.\n\S/,
      );
      expect(audit).toEqual([]);
      expect(rescans()).toBe(0);
    }),
  );

  it.effect("runs one T3 Code update at a time across sessions", () =>
    Effect.gen(function* () {
      const policyRequested = yield* Deferred.make<void>();
      const policy = yield* Deferred.make<AgentPolicy>();

      const { session } = yield* setUp({
        loadPolicy: Deferred.succeed(policyRequested, undefined).pipe(
          Effect.andThen(Deferred.await(policy)),
        ),
      });

      const ended = session();
      const next = session();
      const first = yield* Effect.forkChild(ended.update("0.0.47"));

      yield* Deferred.await(policyRequested);
      ended.close();
      yield* next.update("0.0.47");
      yield* Deferred.succeed(policy, { allowedTiers: [] });
      yield* Fiber.join(first);

      expect(next.reports).toEqual(failedWith("T3 Code is already updating."));
      expect(ended.reports).toEqual([]);
    }),
  );
});
