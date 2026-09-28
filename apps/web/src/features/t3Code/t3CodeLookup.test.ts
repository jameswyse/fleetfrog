import { DateTime } from "effect";
import { describe, expect, it } from "vitest";

import { MachineId } from "@fleetfrog/protocol/domain/machine";

import { busyThreads, threadsAt, worktreeThread } from "./t3CodeLookup.ts";

import type { Machine } from "@fleetfrog/protocol/domain/fleet";
import type { T3CodeThread } from "@fleetfrog/protocol/domain/t3Code";

const at = DateTime.makeUnsafe("2026-09-27T00:00:00Z");

function thread(
  title: string,
  path: string,
  state: T3CodeThread["state"],
  options: { readonly worktree?: boolean; readonly archived?: boolean } = {},
): T3CodeThread {
  return {
    id: title,
    projectId: "p1",
    title,
    path,
    worktree: options.worktree ?? false,
    state,
    archived: options.archived ?? false,
    updatedAt: at,
  };
}

function machineWith(threads: ReadonlyArray<T3CodeThread>): Machine {
  return {
    id: MachineId.make("aaaaaaaa-0000-4000-8000-000000000000"),
    info: {
      hostname: "studio",
      prettyName: null,
      platform: "darwin",
      homeDirectory: "/Users/dev",
      agentVersion: "0.0.0",
      agentRuntime: "node",
      githubCli: { _tag: "Unavailable", reason: "" },
      system: null,
    },
    customName: null,
    customKind: null,
    connection: { _tag: "Offline", lastSeenAt: null },
    discoveryRoots: [],
    archiveFolder: null,
    archiveFolderStatus: null,
    lastDiscoveryAt: null,
    lastStatusAt: null,
    pairedAt: at,
    usage: null,
    update: null,
    trash: [],
    t3Code: {
      database: "/Users/dev/.t3/userdata/state.sqlite",
      reading: {
        _tag: "Read",
        schema: { migration: 54, name: "ProjectionThreadsAutoSettleDisabledAt" },
        projects: [],
        threads,
        threadCount: threads.length,
        unreadRecords: 0,
      },
      server: null,
      providers: [],
    },
  };
}

const shop = "/Users/dev/Projects/shop";
const fix = "/Users/dev/.t3/worktrees/shop/fix";

describe("T3 Code lookups", () => {
  const machine = machineWith([
    thread("Refactor", shop, "Working"),
    thread("Needs approval", shop, "Waiting"),
    thread("Done", shop, "Idle"),
    thread("Old", shop, "Idle", { archived: true }),
    thread("Fix bug", fix, "Idle", { worktree: true, archived: true }),
    thread("Elsewhere", "/Users/dev/Projects/site", "Working"),
  ]);

  it("finds threads part-way through a turn in the given folders, waiting ones first", () => {
    expect(busyThreads(machine, [shop, fix]).map(({ title }) => title)).toEqual([
      "Needs approval",
      "Refactor",
    ]);
  });

  it("lists a folder's threads that aren't archived", () => {
    expect(threadsAt(machine, shop).map(({ title }) => title)).toEqual([
      "Refactor",
      "Needs approval",
      "Done",
    ]);
  });

  it("finds the thread a worktree was made for, even once it's archived", () => {
    expect(worktreeThread(machine, fix)?.title).toBe("Fix bug");
    expect(worktreeThread(machine, shop)).toBeUndefined();
  });

  it("finds nothing while the integration is off", () => {
    expect(busyThreads({ ...machine, t3Code: null }, [shop])).toEqual([]);
  });
});
