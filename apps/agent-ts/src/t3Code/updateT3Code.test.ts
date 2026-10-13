import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";

import {
  fakeT3CodeApp,
  installFakeT3CodeCli,
  supportedDescriptor,
} from "../testing/fakeT3CodeApp.ts";
import {
  runningT3CodeServer,
  startT3CodeProcess,
  writeT3CodeRuntime,
} from "../testing/t3CodeServer.ts";
import { temporaryDirectory } from "../testing/temporaryDirectory.ts";
import { makeT3CodeUpdater } from "./updateT3Code.ts";

import type { T3CodeUpdateOutcome } from "@fleetfrog/protocol/domain/t3CodeUpdate";

import type { AuditEntry } from "../audit/auditLog.ts";
import type { ConfigUnavailable } from "../config/agentConfig.ts";
import type { AgentPolicy } from "../config/agentPolicy.ts";
import type { FakeAppSocket } from "../testing/fakeT3CodeApp.ts";
import type { T3CodeUpdateSession } from "./updateT3Code.ts";

const allowed: AgentPolicy = { allowedTiers: ["git", "cleanup", "update", "t3code"] };

function addWorkingThread(file: string, id: string) {
  const database = new DatabaseSync(file);

  database.exec(`
    insert into projection_threads values ('${id}', 'project', '${id}', null, null, null,
      '2026-10-13T00:00:00.000Z', 0, 0);
    insert into projection_thread_sessions values ('${id}', 'running', null);
  `);
  database.close();
}

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

  database.close();

  for (let index = 0; index < workingThreads; index += 1) {
    addWorkingThread(file, `thread-${index}`);
  }
}

const setUp = (options: { readonly loadPolicy?: Effect.Effect<AgentPolicy, ConfigUnavailable> }) =>
  Effect.gen(function* () {
    const home = yield* temporaryDirectory("fleetfrog-t3update-");
    const userdata = path.join(home, "userdata");

    mkdirSync(userdata);

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

    return { home, userdata, database, audit, session, reports, rescans, update };
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

const progress = (stage: string) => ({
  _tag: "Chunk",
  requestId: "1",
  values: [{ type: "progress", stage }],
});

const complete = (targetVersion: string) => ({
  _tag: "Chunk",
  requestId: "1",
  values: [
    {
      type: "complete",
      result: { targetVersion, method: "desktop-app", desktopUpdateToken: "prepared-1" },
    },
  ],
});

const prepared = { _tag: "Exit", requestId: "1", exit: { _tag: "Success", value: null } };

const setUpApp = (options: {
  readonly descriptor?: unknown;
  readonly onPrepare: (socket: FakeAppSocket, database: string) => void;
  readonly onCommit?: (socket: FakeAppSocket) => void;
}) =>
  Effect.gen(function* () {
    const test = yield* setUp({});
    const calls = installFakeT3CodeCli(test.home);

    createDatabase(test.database, 0);

    const app = yield* fakeT3CodeApp({
      descriptor: options.descriptor,
      onPrepare: (socket) => options.onPrepare(socket, test.database),
      onCommit: options.onCommit,
    });

    yield* runningT3CodeServer(test.userdata, false, { port: app.port });

    return { ...test, calls, received: app.received };
  });

const requests = (received: ReadonlyArray<unknown>) =>
  received.flatMap((message) =>
    typeof message === "object" && message !== null && "tag" in message ? [message.tag] : [],
  );

const revocations = (calls: () => ReadonlyArray<string>, home: string) =>
  calls()
    .filter((call) => call.startsWith("auth session revoke"))
    .map((call) => call.replace(home, "<home>"));

describe("makeT3CodeUpdater for T3 Code's desktop app", () => {
  it.live("prepares the update, installs it and waits for the app to relaunch", () =>
    Effect.gen(function* () {
      const relaunched = yield* startT3CodeProcess("0.0.47");

      const test = yield* setUpApp({
        onPrepare: (socket) => {
          socket.send({ _tag: "Ping" });
          socket.send(progress("downloading"));
          socket.send([progress("installing"), complete("0.0.47"), prepared]);
        },
        onCommit: (socket) => {
          socket.close();
          setTimeout(() => {
            writeT3CodeRuntime(path.dirname(test.database), { pid: relaunched });
          }, 200);
        },
      });

      yield* test.update("0.0.50");

      expect(test.reports).toEqual([{ version: "0.0.47", outcome: { _tag: "Updated" } }]);
      expect(test.rescans()).toBe(1);
      expect(test.audit).toEqual([
        { event: "T3CodeUpdated", previousVersion: "0.0.46", version: "0.0.47" },
      ]);
      expect(test.received).toEqual([
        {
          _tag: "Request",
          id: "1",
          tag: "server.updateServerWithProgress",
          payload: { targetVersion: "0.0.50" },
          headers: [],
        },
        { _tag: "Pong" },
        { _tag: "Ack", requestId: "1" },
        { _tag: "Ack", requestId: "1" },
        { _tag: "Ack", requestId: "1" },
        {
          _tag: "Request",
          id: "2",
          tag: "server.commitDesktopUpdate",
          payload: { requestId: "prepared-1" },
          headers: [],
        },
      ]);
      expect(test.calls()[0]).toBe(
        `auth session issue --base-dir ${test.home} --scope environment:maintain --scope orchestration:read --ttl 30m --label FleetFrog --json`,
      );
      expect(revocations(test.calls, test.home)).toEqual([
        "auth session revoke session-1 --base-dir <home>",
      ]);
    }),
  );

  it.live("reports the reason T3 Code's app gives for not updating", () =>
    Effect.gen(function* () {
      const test = yield* setUpApp({
        onPrepare: (socket) =>
          socket.send({
            _tag: "Exit",
            requestId: "1",
            exit: {
              _tag: "Failure",
              cause: [
                {
                  _tag: "Fail",
                  error: {
                    _tag: "ServerSelfUpdateError",
                    reason: "T3 Code is already up to date.",
                  },
                },
              ],
            },
          }),
      });

      yield* test.update("0.0.47");

      expect(test.reports).toEqual(failedWith("T3 Code is already up to date."));
      expect(requests(test.received)).toEqual(["server.updateServerWithProgress"]);
      expect(revocations(test.calls, test.home)).toHaveLength(1);
    }),
  );

  it.live("doesn't install a version that isn't newer than the running one", () =>
    Effect.gen(function* () {
      const test = yield* setUpApp({
        descriptor: { ...supportedDescriptor, serverVersion: "0.0.47" },
        onPrepare: (socket) => socket.send([complete("0.0.47"), prepared]),
      });

      yield* test.update("0.0.47");

      expect(test.reports).toEqual(
        failedWith("T3 Code's app offered 0.0.47, which isn't newer than 0.0.47."),
      );
      expect(requests(test.received)).toEqual(["server.updateServerWithProgress"]);
      expect(revocations(test.calls, test.home)).toHaveLength(1);
    }),
  );

  it.live("doesn't install the update when a thread starts working while it downloads", () =>
    Effect.gen(function* () {
      const test = yield* setUpApp({
        onPrepare: (socket, database) => {
          addWorkingThread(database, "started");
          socket.send([complete("0.0.47"), prepared]);
        },
      });

      yield* test.update("0.0.47");

      expect(test.reports).toEqual(
        failedWith("T3 Code is running 1 thread. Try again when it finishes."),
      );
      expect(requests(test.received)).toEqual(["server.updateServerWithProgress"]);
      expect(revocations(test.calls, test.home)).toHaveLength(1);
    }),
  );

  it.live("refuses a version of T3 Code's app it doesn't support", () =>
    Effect.gen(function* () {
      const test = yield* setUpApp({
        descriptor: {
          ...supportedDescriptor,
          capabilities: { ...supportedDescriptor.capabilities, serverSelfUpdate: "boot-service" },
        },
        onPrepare: () => {},
      });

      yield* test.update("0.0.47");

      expect(test.reports).toEqual(
        failedWith("FleetFrog doesn't support updating this version of T3 Code's desktop app."),
      );
      expect(test.received).toEqual([]);
      expect(revocations(test.calls, test.home)).toHaveLength(1);
    }),
  );

  it.live("needs the desktop app's command-line tool", () =>
    Effect.gen(function* () {
      const test = yield* setUp({});

      createDatabase(test.database, 0);
      yield* runningT3CodeServer(test.userdata, false, { port: 1 });
      yield* test.update("0.0.47");

      expect(test.reports).toEqual(
        failedWith(
          `Couldn't find T3 Code's command-line tool at ${path.join(test.home, "bin", "t3")}.`,
        ),
      );
    }),
  );
});
