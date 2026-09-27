import { DateTime } from "effect";
import { describe, expect, it } from "vitest";

import { MachineId } from "@fleetfrog/protocol/domain/machine";

import { summariseCell } from "./cellSummary.ts";

import type { Checkout, GitStatus } from "@fleetfrog/protocol/domain/checkout";
import type { MachineCheckout } from "@fleetfrog/protocol/domain/fleet";

const at = DateTime.makeUnsafe("2026-09-26T00:00:00Z");
const none = { items: [], total: 0 };
const studio = MachineId.make("5b0c7a1e-7a0e-4f3e-9d63-2f8f7a8d0a01");

function entry(
  path: string,
  options: { readonly branch: string; readonly git?: Partial<GitStatus>; readonly main?: string },
): MachineCheckout {
  const checkout: Checkout = {
    path,
    identity: { _tag: "Remote", host: "github.com", path: "acme/shop" },
    originUrl: null,
    directoryName: "shop",
    worktree:
      options.main === undefined ? { _tag: "Main" } : { _tag: "Linked", mainPath: options.main },
    status: {
      _tag: "Read",
      git: {
        head: {
          _tag: "Branch",
          name: options.branch,
          upstream: { name: `origin/${options.branch}`, ahead: 0, behind: 0, gone: false },
        },
        operation: null,
        lastCommit: null,
        changed: none,
        untracked: none,
        stashes: none,
        branches: none,
        defaultBranch: null,
        deletedBranches: { items: [], total: 0 },
        lastFetchedAt: null,
        ...options.git,
      },
    },
    github: {
      defaultBranch: "main",
      remoteSha: "a",
      trackingSha: "a",
      pullRequests: [],
      mergedPullRequests: [],
      checkedAt: at,
    },
    scannedAt: at,
  };

  return { machineId: studio, checkout };
}

describe("summariseCell", () => {
  it("speaks for the main clone and counts changes in every worktree, but stashes once per clone", () => {
    const stashes = { items: [{ index: 0, message: "WIP" }], total: 1 };
    const cell = summariseCell([
      entry("/p/shop-icons", {
        branch: "icons",
        main: "/p/shop",
        git: { changed: { items: [], total: 2 }, stashes },
      }),
      entry("/p/shop", {
        branch: "main",
        git: {
          untracked: { items: ["notes.md"], total: 1 },
          stashes,
          branches: { items: [], total: 3 },
          head: {
            _tag: "Branch",
            name: "main",
            upstream: { name: "origin/main", ahead: 1, behind: 4, gone: false },
          },
        },
      }),
    ]);

    expect(cell).toMatchObject({
      branch: "main",
      offDefault: false,
      changes: 3,
      stashes: 1,
      ahead: 1,
      behind: 4,
      branches: 3,
      worktrees: 1,
      clones: 1,
      problem: null,
    });
    expect(cell?.primary.checkout.path).toBe("/p/shop");
    expect(cell?.entries.map(({ checkout }) => checkout.path)).toEqual([
      "/p/shop",
      "/p/shop-icons",
    ]);
  });

  it("flags a problem in any worktree and a primary branch other than the default", () => {
    const cell = summariseCell([
      entry("/p/shop", { branch: "feature" }),
      entry("/p/shop-fix", {
        branch: "fix",
        main: "/p/shop",
        git: {
          head: {
            _tag: "Branch",
            name: "fix",
            upstream: { name: "origin/fix", ahead: 0, behind: 0, gone: true },
          },
        },
      }),
    ]);

    expect(cell).toMatchObject({ branch: "feature", offDefault: true, problem: "UpstreamGone" });
  });

  it("has no cell without checkouts", () => {
    expect(summariseCell([])).toBeNull();
  });
});
