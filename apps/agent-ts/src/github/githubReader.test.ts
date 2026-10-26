import { describe, expect, it } from "@effect/vitest";
import { Duration } from "effect";

import { localBranchNames, retryDelay } from "./githubReader.ts";

import type { GitStatus } from "@fleetfrog/protocol/domain/checkout";

describe("retryDelay", () => {
  it("retries less often after each failure, up to the interval", () => {
    const interval = Duration.seconds(900);

    const delays = [1, 2, 3, 4, 5, 6].map((failures) =>
      Duration.toSeconds(retryDelay(failures, interval)),
    );

    expect(delays).toStrictEqual([60, 120, 240, 480, 900, 900]);
    expect(Duration.toSeconds(retryDelay(40, interval))).toBe(900);
    expect(Duration.toSeconds(retryDelay(1, Duration.zero))).toBe(0);
  });
});

describe("localBranchNames", () => {
  const none = { items: [], total: 0 };

  const status = (head: GitStatus["head"]): GitStatus => ({
    head,
    operation: null,
    lastCommit: null,
    changed: none,
    untracked: none,
    stashes: none,
    branches: {
      items: [{ name: "main", upstream: null, tip: null }],
      total: 300,
    },
    defaultBranch: "main",
    deletedBranches: none,
    droppedStashes: none,
    worktrees: [],
    lastFetchedAt: null,
  });

  it("adds the checked-out branch when the branch list was cut short before it", () => {
    const late = localBranchNames(status({ _tag: "Branch", name: "zz/late", upstream: null }));

    expect(late).toHaveLength(2);
    expect(new Set(late)).toStrictEqual(new Set(["main", "zz/late"]));
    expect(
      localBranchNames(status({ _tag: "Branch", name: "main", upstream: null })),
    ).toStrictEqual(["main"]);
    expect(localBranchNames(status({ _tag: "Detached" }))).toStrictEqual(["main"]);
  });
});
