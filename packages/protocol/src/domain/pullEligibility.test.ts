import { describe, expect, it } from "@effect/vitest";

import { pullBlocker } from "./pullEligibility.ts";

import type { GitStatus, Head } from "./checkout.ts";

function status(options: {
  readonly head: Head;
  readonly changed?: number;
  readonly operation?: GitStatus["operation"];
}): GitStatus {
  return {
    head: options.head,
    operation: options.operation ?? null,
    lastCommit: null,
    changed: { items: [], total: options.changed ?? 0 },
    untracked: { items: ["notes.txt"], total: 1 },
    stashes: { items: [], total: 0 },
    branches: { items: [], total: 0 },
    lastFetchedAt: null,
  };
}

const tracking = (ahead: number, behind: number, gone = false): Head => ({
  _tag: "Branch",
  name: "main",
  upstream: { name: "origin/main", ahead, behind, gone },
});

describe("pullBlocker", () => {
  it("allows a clean branch with nothing to push, even with untracked files", () => {
    expect(pullBlocker(status({ head: tracking(0, 3) }))).toBeNull();
    expect(pullBlocker(status({ head: tracking(0, 0) }))).toBeNull();
  });

  it("skips anything a fast-forward could not safely update", () => {
    const reason = (git: GitStatus) => pullBlocker(git)?._tag;

    expect(reason(status({ head: { _tag: "Detached" } }))).toBe("Detached");
    expect(reason(status({ head: { _tag: "Unborn", name: "main" } }))).toBe("NoCommits");
    expect(reason(status({ head: { _tag: "Branch", name: "main", upstream: null } }))).toBe(
      "NoUpstream",
    );
    expect(reason(status({ head: tracking(0, 1, true) }))).toBe("UpstreamGone");
    expect(reason(status({ head: tracking(0, 1), operation: "rebase" }))).toBe(
      "OperationInProgress",
    );
    expect(pullBlocker(status({ head: tracking(0, 1), changed: 2 }))).toEqual({
      _tag: "UncommittedChanges",
      files: 2,
    });
    expect(pullBlocker(status({ head: tracking(1, 1) }))).toEqual({
      _tag: "UnpushedCommits",
      commits: 1,
    });
  });
});
