import { DateTime } from "effect";
import { describe, expect, it } from "vitest";

import { tidyCandidates } from "./branchTidying.ts";

import type { Checkout, GitStatus, LocalBranch } from "@fleetfrog/protocol/domain/checkout";

const at = DateTime.makeUnsafe("2026-09-26T00:00:00Z");

function branch(
  name: string,
  tip: { readonly sha?: string; readonly merged?: boolean; readonly pushed?: boolean } = {},
): LocalBranch {
  return {
    name,
    upstream: null,
    tip: {
      sha: tip.sha ?? `${name}-sha`,
      subject: "Work",
      committedAt: at,
      merged: tip.merged ?? false,
      pushed: tip.pushed ?? tip.merged ?? false,
      localCommits: tip.pushed === true || tip.merged === true ? 0 : 2,
    },
  };
}

const branches = [
  branch("main", { merged: true }),
  branch("current"),
  branch("done", { merged: true }),
  branch("squashed", { sha: "squashed-tip", pushed: true }),
  branch("squashed-then-changed", { sha: "newer-tip", pushed: true }),
  branch("pushed", { pushed: true }),
  branch("local"),
  branch("elsewhere"),
];

const git: GitStatus = {
  head: { _tag: "Branch", name: "current", upstream: null },
  operation: null,
  lastCommit: null,
  changed: { items: [], total: 0 },
  untracked: { items: [], total: 0 },
  stashes: { items: [], total: 0 },
  branches: { items: branches, total: branches.length },
  defaultBranch: "main",
  deletedBranches: { items: [], total: 0 },
  droppedStashes: { items: [], total: 0 },
  worktrees: [],
  lastFetchedAt: null,
};

const checkout: Checkout = {
  path: "/home/dev/Projects/shop",
  identity: { _tag: "Remote", host: "github.com", path: "acme/shop" },
  originUrl: null,
  directoryName: "shop",
  placement: { _tag: "Projects" },
  worktree: { _tag: "Main" },
  status: { _tag: "Read", git },
  github: {
    defaultBranch: "main",
    remoteSha: "main-sha",
    trackingSha: "main-sha",
    pullRequests: [],
    mergedPullRequests: [
      {
        number: 7,
        url: "https://github.com/acme/shop/pull/7",
        branch: "squashed",
        sha: "squashed-tip",
      },
      {
        number: 8,
        url: "https://github.com/acme/shop/pull/8",
        branch: "squashed-then-changed",
        sha: "older-tip",
      },
    ],
    checkedAt: at,
  },
  scannedAt: at,
};

describe("tidyCandidates", () => {
  const standings = new Map(
    tidyCandidates({ checkout, git, inOtherWorktrees: new Set(["elsewhere"]) }).map(
      ({ name, standing }) => [name, standing._tag],
    ),
  );

  it("leaves out the current, default and other worktrees' branches", () => {
    expect([...standings.keys()]).toEqual([
      "done",
      "squashed",
      "squashed-then-changed",
      "pushed",
      "local",
    ]);
  });

  it("counts a merged pull request only when it was merged at the branch's tip", () => {
    expect(standings.get("done")).toBe("Merged");
    expect(standings.get("squashed")).toBe("MergedPullRequest");
    expect(standings.get("squashed-then-changed")).toBe("Pushed");
    expect(standings.get("local")).toBe("LocalOnly");
  });
});
