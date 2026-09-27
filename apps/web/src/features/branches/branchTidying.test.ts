import { DateTime } from "effect";
import { describe, expect, it } from "vitest";

import { MachineId } from "@fleetfrog/protocol/domain/machine";
import { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

import { branchesInOtherWorktrees, isPreselected, tidyCandidates } from "./branchTidying.ts";

import type { Checkout, GitStatus, LocalBranch } from "@fleetfrog/protocol/domain/checkout";
import type { Repository } from "@fleetfrog/protocol/domain/fleet";

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
  const { candidates, kept } = tidyCandidates({
    checkout,
    git,
    inOtherWorktrees: new Map([["elsewhere", "/home/dev/Projects/shop-elsewhere"]]),
  });
  const standings = new Map(candidates.map(({ name, standing }) => [name, standing._tag]));

  it("keeps the current and other worktrees' branches, saying what to do first", () => {
    expect(new Set(standings.keys())).toEqual(
      new Set(["main", "done", "squashed", "squashed-then-changed", "pushed", "local"]),
    );
    expect(kept.map(({ name }) => name)).toEqual(["current", "elsewhere"]);
    expect(kept[1]?.reason).toContain("/home/dev/Projects/shop-elsewhere");
  });

  it("offers the default branch without choosing it to start with", () => {
    const main = candidates.find(({ name }) => name === "main");

    expect(main?.isDefault).toBe(true);
    expect(main !== undefined && isPreselected(main)).toBe(false);
    expect(candidates.filter(isPreselected).map(({ name }) => name)).toEqual(["done", "squashed"]);
  });

  it("counts a merged pull request only when it was merged at the branch's tip", () => {
    expect(standings.get("done")).toBe("Merged");
    expect(standings.get("squashed")).toBe("MergedPullRequest");
    expect(standings.get("squashed-then-changed")).toBe("Pushed");
    expect(standings.get("local")).toBe("LocalOnly");
  });
});

describe("branchesInOtherWorktrees", () => {
  it("includes branches of worktrees the main checkout lists, even ones whose links broke", () => {
    const machineId = MachineId.make("aaaaaaaa-0000-4000-8000-000000000000");
    const main: Checkout = {
      ...checkout,
      status: {
        _tag: "Read",
        git: {
          ...git,
          worktrees: [
            { path: "/home/dev/Projects/shop-fix", branch: "fix", state: "Broken" },
            { path: "/home/dev/Projects/shop-feature", branch: "feature", state: "Present" },
          ],
        },
      },
    };
    const linked: Checkout = {
      ...checkout,
      path: "/home/dev/Projects/shop-feature",
      worktree: { _tag: "Linked", mainPath: checkout.path },
      status: {
        _tag: "Read",
        git: { ...git, head: { _tag: "Branch", name: "feature", upstream: null } },
      },
    };
    const repository: Repository = {
      key: RepositoryKey.make("remote:github.com/acme/shop"),
      identity: checkout.identity,
      name: "shop",
      label: "shop",
      icon: null,
      checkouts: [
        { machineId, checkout: main },
        { machineId, checkout: linked },
      ],
    };
    // From the main checkout, both worktrees' branches are elsewhere.
    expect(
      new Set(branchesInOtherWorktrees({ repository, machineId, checkout: main }).keys()),
    ).toEqual(new Set(["fix", "feature"]));
    // From the linked worktree, its own branch isn't, but main's and the broken one's are.
    expect(
      new Set(branchesInOtherWorktrees({ repository, machineId, checkout: linked }).keys()),
    ).toEqual(new Set(["current", "fix"]));
  });
});
