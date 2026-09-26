import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, Layer } from "effect";

import { BatchId, RunId } from "@fleetfrog/protocol/domain/activity";
import { MachineId } from "@fleetfrog/protocol/domain/machine";
import { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

import { Migrations } from "../persistence/database.ts";
import { ActivityStore } from "./activityStore.ts";

import type { ActionOutcome } from "@fleetfrog/protocol/domain/action";
import type { ActivityPage } from "@fleetfrog/protocol/domain/activity";

import type { NewRun } from "./activityStore.ts";

/** A fresh, fully migrated database for each test. */
const TestStore = ActivityStore.layer.pipe(
  Layer.provide(Migrations.pipe(Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })))),
);

const studio = MachineId.make("aaaaaaaa-0000-4000-8000-000000000000");
const laptop = MachineId.make("bbbbbbbb-0000-4000-8000-000000000000");
const at = (minute: number) => DateTime.makeUnsafe(Date.UTC(2026, 8, 26, 12, minute));
let nextId = 0;

function id(): string {
  nextId += 1;

  return `00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`;
}

function newRun(options: {
  readonly machineId: MachineId;
  readonly path: string;
  readonly outcome?: ActionOutcome;
}): NewRun {
  return {
    id: RunId.make(id()),
    machineId: options.machineId,
    machineName: options.machineId === studio ? "Studio" : "Laptop",
    repositoryKey: RepositoryKey.make("remote:github.com/acme/shop"),
    repositoryName: "shop",
    path: options.path,
    request: { _tag: "Fetch", path: options.path },
    outcome: options.outcome ?? null,
  };
}

const fetched: ActionOutcome = { _tag: "Succeeded", result: { _tag: "Fetched" } };

/** Records a batch of runs requested at the given minute and returns its id and runs. */
const recordBatch = (minute: number, runs: ReadonlyArray<NewRun>) =>
  ActivityStore.use((store) => {
    const batchId = BatchId.make(id());

    return store
      .createBatch({
        id: batchId,
        kind: "Fetch",
        scope: { _tag: "All" },
        requestedAt: at(minute),
        runs,
      })
      .pipe(Effect.as({ batchId, runs }));
  });

describe("ActivityStore", () => {
  it.effect("settles a batch only once its last run finishes", () =>
    Effect.gen(function* () {
      const store = yield* ActivityStore;
      const offline = newRun({
        machineId: laptop,
        path: "/a",
        outcome: { _tag: "MachineOffline" },
      });
      const sent = newRun({ machineId: studio, path: "/b" });
      const { batchId } = yield* recordBatch(0, [offline, sent]);
      const run = { runId: sent.id, machineId: studio };

      expect((yield* store.activeBatches).map(({ id: active }) => active)).toEqual([batchId]);

      yield* store.markStarted({ ...run, at: at(1) });
      yield* store.markProgress({ ...run, line: "Receiving objects: 43%" });

      expect((yield* store.activeRuns)[0]?.state).toMatchObject({
        _tag: "Running",
        progress: "Receiving objects: 43%",
      });

      yield* store.markFinished({ ...run, outcome: fetched, output: ["done"], at: at(2) });

      expect(yield* store.activeBatches).toEqual([]);
      expect((yield* store.batch(batchId)).batch).toMatchObject({
        finishedAt: at(2),
        counts: { MachineOffline: 1, Succeeded: 1, Queued: 0, Running: 0 },
      });
    }).pipe(Effect.provide(TestStore)),
  );

  it.effect("ignores a report from a machine that isn't running the run", () =>
    Effect.gen(function* () {
      const store = yield* ActivityStore;
      const sent = newRun({ machineId: studio, path: "/b" });

      yield* recordBatch(0, [sent]);

      expect(
        yield* store.markFinished({
          runId: sent.id,
          machineId: laptop,
          outcome: fetched,
          output: [],
          at: at(1),
        }),
      ).toBe(false);
      expect((yield* store.activeRuns).map(({ id: active }) => active)).toEqual([sent.id]);
    }).pipe(Effect.provide(TestStore)),
  );

  it.effect("keeps each checkout's newest result, ignoring offline machines", () =>
    Effect.gen(function* () {
      const store = yield* ActivityStore;
      const older = newRun({ machineId: studio, path: "/shop", outcome: fetched });
      const newer = newRun({ machineId: studio, path: "/shop" });

      yield* recordBatch(0, [older]);
      yield* recordBatch(5, [newer]);
      yield* store.markFinished({
        runId: newer.id,
        machineId: studio,
        outcome: { _tag: "Failed", message: "no network" },
        output: [],
        at: at(6),
      });
      yield* recordBatch(9, [
        newRun({ machineId: studio, path: "/shop", outcome: { _tag: "MachineOffline" } }),
      ]);

      expect((yield* store.latestRuns).map(({ id: latest }) => latest)).toEqual([newer.id]);
    }).pipe(Effect.provide(TestStore)),
  );

  it.effect("pages history newest first and filters it by outcome", () =>
    Effect.gen(function* () {
      const store = yield* ActivityStore;
      yield* recordBatch(1, [newRun({ machineId: studio, path: "/a", outcome: fetched })]);
      const second = yield* recordBatch(2, [
        newRun({ machineId: studio, path: "/a", outcome: { _tag: "Failed", message: "denied" } }),
      ]);
      const third = yield* recordBatch(3, [
        newRun({ machineId: laptop, path: "/a", outcome: fetched }),
      ]);
      const all = { machineId: null, repositoryKey: null, outcome: null };
      const batchIds = (page: ActivityPage) =>
        page.entries.map((entry) => (entry._tag === "Batch" ? entry.batch.id : null));

      const page = yield* store.activity({ filter: all, limit: 2 });

      expect(batchIds(page)).toEqual([third.batchId, second.batchId]);
      expect(page.hasMore).toBe(true);
      expect(
        batchIds(yield* store.activity({ filter: { ...all, outcome: "Failed" }, limit: 10 })),
      ).toEqual([second.batchId]);
      expect(
        batchIds(yield* store.activity({ filter: { ...all, machineId: laptop }, limit: 10 })),
      ).toEqual([third.batchId]);
    }).pipe(Effect.provide(TestStore)),
  );
});
