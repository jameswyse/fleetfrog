import { describe, expect, it } from "@effect/vitest";

import { switchBlocker } from "./switchEligibility.ts";

import type { GitStatus, Head } from "./checkout.ts";

function status(options: {
  readonly head?: Head;
  readonly changed?: number;
  readonly branches?: ReadonlyArray<string>;
  readonly branchTotal?: number;
}): GitStatus {
  const branches = options.branches ?? ["main", "feature"];

  return {
    head: options.head ?? { _tag: "Branch", name: "main", upstream: null },
    operation: null,
    lastCommit: null,
    changed: { items: [], total: options.changed ?? 0 },
    untracked: { items: ["notes.txt"], total: 1 },
    stashes: { items: [], total: 0 },
    branches: {
      items: branches.map((name) => ({ name, upstream: null, tip: null })),
      total: options.branchTotal ?? branches.length,
    },
    defaultBranch: null,
    deletedBranches: { items: [], total: 0 },
    droppedStashes: { items: [], total: 0 },
    worktrees: [],
    lastFetchedAt: null,
  };
}

describe("switchBlocker", () => {
  it("allows a switch with only untracked files", () => {
    expect(switchBlocker(status({}), "feature")).toBeNull();
  });

  it("skips a switch that would carry changes or leave commits behind", () => {
    expect(switchBlocker(status({ changed: 2 }), "feature")?._tag).toBe("UncommittedChanges");
    expect(switchBlocker(status({ head: { _tag: "Detached" } }), "feature")?._tag).toBe("Detached");
    expect(switchBlocker(status({}), "main")?._tag).toBe("AlreadyOnBranch");
  });

  it("rules out a missing branch only when every branch was listed", () => {
    expect(switchBlocker(status({}), "gone")?._tag).toBe("NoSuchBranch");
    expect(switchBlocker(status({ branchTotal: 500 }), "unlisted")).toBeNull();
  });
});
