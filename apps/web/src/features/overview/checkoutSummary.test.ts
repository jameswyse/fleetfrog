import { DateTime } from "effect";
import { describe, expect, it } from "vitest";

import { MachineId } from "@fleetfrog/protocol/domain/machine";
import { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

import { repositoryMatches, summariseCheckout } from "./checkoutSummary.ts";

import type { Checkout, GitStatus } from "@fleetfrog/protocol/domain/checkout";
import type { Repository } from "@fleetfrog/protocol/domain/fleet";

const at = DateTime.makeUnsafe("2026-09-26T00:00:00Z");
const none = { items: [], total: 0 };

function checkout(git: Partial<GitStatus>, github: Checkout["github"] = null): Checkout {
  return {
    path: "/home/dev/Projects/shop",
    identity: { _tag: "Remote", host: "github.com", path: "acme/shop" },
    directoryName: "shop",
    worktree: { _tag: "Main" },
    status: {
      _tag: "Read",
      git: {
        head: {
          _tag: "Branch",
          name: "main",
          upstream: { name: "origin/main", ahead: 0, behind: 0, gone: false },
        },
        lastCommit: null,
        changed: none,
        untracked: none,
        stashes: none,
        branches: none,
        lastFetchedAt: null,
        ...git,
      },
    },
    github,
    scannedAt: at,
  };
}

function repository(name: string, checkouts: ReadonlyArray<Checkout>): Repository {
  return {
    key: RepositoryKey.make(`remote:github.com/acme/${name}`),
    identity: { _tag: "Remote", host: "github.com", path: `acme/${name}` },
    name,
    checkouts: checkouts.map((entry) => ({
      machineId: MachineId.make("5b0c7a1e-7a0e-4f3e-9d63-2f8f7a8d0a01"),
      checkout: entry,
    })),
  };
}

describe("summariseCheckout", () => {
  it("treats a checkout whose GitHub default branch moved past its last fetch as out of sync", () => {
    const summary = summariseCheckout(
      checkout(
        {},
        {
          defaultBranch: "main",
          remoteSha: "b",
          trackingSha: "a",
          pullRequests: [],
          checkedAt: at,
        },
      ),
    );

    expect(summary).toMatchObject({
      _tag: "Read",
      remoteMoved: true,
      outOfSync: true,
      hasChanges: false,
    });
  });

  it("counts stashes as changes and flags unmerged files as conflicts", () => {
    const summary = summariseCheckout(
      checkout({
        changed: {
          items: [{ path: "a.ts", originalPath: null, staged: "U", unstaged: "U" }],
          total: 1,
        },
        stashes: { items: [{ index: 0, message: "wip" }], total: 1 },
      }),
    );

    expect(summary).toMatchObject({ conflicts: true, hasChanges: true, outOfSync: false });
  });
});

describe("repositoryMatches", () => {
  const clean = repository("shop", [checkout({})]);
  const behind = repository("api", [
    checkout({
      head: {
        _tag: "Branch",
        name: "main",
        upstream: { name: "origin/main", ahead: 0, behind: 2, gone: false },
      },
    }),
  ]);

  const unreadable = repository("legacy", [
    { ...checkout({}), status: { _tag: "Failed", message: "fatal: not a git repository" } },
  ]);

  it("matches names case-insensitively", () => {
    expect(repositoryMatches({ repository: clean, filter: "all", query: "SHO" })).toBe(true);
    expect(repositoryMatches({ repository: clean, filter: "all", query: "api" })).toBe(false);
  });

  it("shows only repositories with a checkout that is out of sync", () => {
    expect(repositoryMatches({ repository: clean, filter: "out-of-sync", query: "" })).toBe(false);
    expect(repositoryMatches({ repository: behind, filter: "out-of-sync", query: "" })).toBe(true);
  });

  it("does not count commits to pull as changes", () => {
    expect(repositoryMatches({ repository: behind, filter: "changes", query: "" })).toBe(false);
  });

  it("keeps unreadable checkouts in every filter", () => {
    expect(repositoryMatches({ repository: unreadable, filter: "changes", query: "" })).toBe(true);
    expect(repositoryMatches({ repository: unreadable, filter: "out-of-sync", query: "" })).toBe(
      true,
    );
  });
});
