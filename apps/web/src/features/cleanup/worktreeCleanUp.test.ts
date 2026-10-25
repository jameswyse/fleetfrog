import { DateTime } from "effect";
import { describe, expect, it } from "vitest";

import { MachineId } from "@fleetfrog/protocol/domain/machine";

import {
  branchDeletionRuns,
  cleanUpCheck,
  cleanUpLosses,
  deletedBranchCount,
  removedWorktrees,
} from "./worktreeCleanUp.ts";

import type { ActionRun } from "@fleetfrog/protocol/domain/activity";
import type { WorktreeInspection } from "@fleetfrog/protocol/domain/trash";

import type { FinishedWorktree } from "./worktreeCleanUp.ts";

const at = DateTime.makeUnsafe("2026-10-20T00:00:00Z");
const studio = MachineId.make("aaaaaaaa-0000-4000-8000-000000000000");
const main = "/Users/dev/Projects/shop";

const header: FinishedWorktree = {
  mainPath: main,
  path: "/Users/dev/wt/header",
  branch: "fix/header",
  sha: "f1",
};

const search: FinishedWorktree = {
  mainPath: main,
  path: "/Users/dev/wt/search",
  branch: "feat/search",
  sha: "s1",
};

const clean: WorktreeInspection = {
  fingerprint: "fp",
  path: header.path,
  missing: null,
  branch: header.branch,
  locked: null,
  changedFiles: 0,
  untrackedFiles: 0,
  unreachableCommits: 0,
  ignored: { items: [], total: 0 },
  caches: [],
};

function ready(changes: Partial<WorktreeInspection>) {
  return { _tag: "Ready", inspection: { ...clean, ...changes } } as const;
}

function finished(
  request: ActionRun["request"],
  result:
    | { readonly _tag: "WorktreeRemoved" }
    | { readonly _tag: "BranchesDeleted"; readonly branches: number },
): Pick<ActionRun, "request" | "state"> {
  return {
    request,
    state: {
      _tag: "Finished",
      startedAt: at,
      finishedAt: at,
      outcome: {
        _tag: "Succeeded",
        result:
          result._tag === "WorktreeRemoved"
            ? {
                _tag: "WorktreeRemoved",
                stashedFiles: 0,
                discardedFiles: 0,
                savedCommits: 0,
                deletedIgnored: 0,
              }
            : { _tag: "BranchesDeleted", branches: result.branches, skipped: [] },
      },
    },
  };
}

function removal(worktree: FinishedWorktree): ActionRun["request"] {
  return {
    _tag: "RemoveWorktree",
    path: worktree.mainPath,
    worktree: worktree.path,
    fingerprint: "fp",
    discardChanges: false,
  };
}

describe("cleanUpCheck", () => {
  it("removes a clean worktree still on its finished branch", () => {
    expect(
      cleanUpCheck({ worktree: header, inspection: ready({}), busy: false, finished: true }),
    ).toStrictEqual({
      _tag: "Removable",
      inspection: clean,
    });
  });

  it("keeps a worktree that moved to another branch, gained changes, is locked or lost its disk", () => {
    const kept = [
      { branch: "feat/other" },
      { branch: null },
      { untrackedFiles: 1 },
      { locked: "" },
      { missing: { parentMissing: true } },
    ].map(
      (changes) =>
        cleanUpCheck({
          worktree: header,
          inspection: ready(changes),
          busy: false,
          finished: true,
        })._tag,
    );

    expect(kept).toStrictEqual(["Kept", "Kept", "Kept", "Kept", "Kept"]);
  });

  it("keeps a worktree that T3 Code started working in or that stopped being finished after the dialog opened", () => {
    const kept = [
      { busy: true, finished: true },
      { busy: false, finished: false },
    ].map((state) => cleanUpCheck({ worktree: header, inspection: ready({}), ...state })._tag);

    expect(kept).toStrictEqual(["Kept", "Kept"]);
  });
});

describe("cleanUpLosses", () => {
  it("names the ignored files and caches the folder takes with it", () => {
    const losses = cleanUpLosses({
      ...clean,
      ignored: { items: [{ path: "config/.env", sizeBytes: 10 }], total: 1 },
      caches: [{ path: "web/node_modules", sizeBytes: 10 }],
    });

    expect(losses).toContain(".env");
    expect(losses).toContain("node_modules");
    expect(losses).not.toContain("config/");
  });
});

describe("branchDeletionRuns", () => {
  it("deletes the branches of removed worktrees once per clone and once per branch", () => {
    const removed = removedWorktrees({
      worktrees: [header, search, { ...header, path: "/Users/dev/wt/header-2" }],
      runs: [
        finished(removal(header), { _tag: "WorktreeRemoved" }),
        finished(removal({ ...header, path: "/Users/dev/wt/header-2" }), {
          _tag: "WorktreeRemoved",
        }),
        { request: removal(search), state: { _tag: "Queued" } },
      ],
    });

    expect(branchDeletionRuns({ machineId: studio, removed })).toStrictEqual([
      {
        machineId: studio,
        request: {
          _tag: "DeleteBranches",
          path: main,
          branches: [{ name: "fix/header", sha: "f1" }],
        },
      },
    ]);
  });

  it("has nothing to delete when no worktree was removed", () => {
    expect(branchDeletionRuns({ machineId: studio, removed: [] })).toBeNull();
  });
});

describe("deletedBranchCount", () => {
  it("adds up the branches each successful run deleted", () => {
    const request = {
      _tag: "DeleteBranches",
      path: main,
      branches: [{ name: "fix/header", sha: "f1" }],
    } as const;

    expect(
      deletedBranchCount([
        finished(request, { _tag: "BranchesDeleted", branches: 2 }),
        finished(request, { _tag: "BranchesDeleted", branches: 1 }),
        { request, state: { _tag: "Queued" } },
      ]),
    ).toBe(3);
  });
});
