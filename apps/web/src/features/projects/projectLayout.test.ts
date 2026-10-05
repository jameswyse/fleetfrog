import { DateTime } from "effect";
import { describe, expect, it } from "vitest";

import { MachineId } from "@fleetfrog/protocol/domain/machine";
import { defaultProjectLayout, ProjectGroupId } from "@fleetfrog/protocol/domain/preferences";
import { repositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

import { arrangeProjects, sectionTitle, sortRepositories, visibleRows } from "./projectLayout.ts";

import type { GitStatus } from "@fleetfrog/protocol/domain/checkout";
import type { Repository } from "@fleetfrog/protocol/domain/fleet";
import type { ProjectLayout } from "@fleetfrog/protocol/domain/preferences";
import type { RepositoryIdentity } from "@fleetfrog/protocol/domain/repositoryIdentity";

const none = { items: [], total: 0 };
const studio = MachineId.make("5b0c7a1e-7a0e-4f3e-9d63-2f8f7a8d0a01");
const work = ProjectGroupId.make("0b8f6a52-7f9e-4c55-9a8e-2f4a1c9d3e10");
const tools = ProjectGroupId.make("1c8f6a52-7f9e-4c55-9a8e-2f4a1c9d3e10");

function repository(
  label: string,
  options: {
    readonly identity?: RepositoryIdentity;
    readonly committedAt?: string;
    readonly git?: Partial<GitStatus>;
  } = {},
): Repository {
  const identity = options.identity ?? {
    _tag: "Remote",
    host: "github.com",
    path: `acme/${label}`,
  };

  const at = DateTime.makeUnsafe(options.committedAt ?? "2026-01-01T00:00:00Z");

  return {
    key: repositoryKey(identity),
    identity,
    name: label,
    label,
    icon: null,
    checkouts: [
      {
        machineId: studio,
        checkout: {
          path: `/p/${label}`,
          identity,
          originUrl: null,
          directoryName: label,
          placement: { _tag: "Projects" },
          worktree: { _tag: "Main" },
          status: {
            _tag: "Read",
            git: {
              head: {
                _tag: "Branch",
                name: "main",
                upstream: { name: "origin/main", ahead: 0, behind: 0, gone: false },
              },
              operation: null,
              lastCommit: { sha: "a", subject: "", committedAt: at },
              changed: none,
              untracked: none,
              stashes: none,
              branches: none,
              defaultBranch: null,
              deletedBranches: none,
              droppedStashes: none,
              worktrees: [],
              lastFetchedAt: null,
              ...options.git,
            },
          },
          github: null,
          scannedAt: at,
        },
      },
    ],
  };
}

const shop = repository("shop");
const api = repository("api");

const blog = repository("blog", {
  identity: { _tag: "Remote", host: "github.com", path: "me/blog" },
});

const scratch = repository("scratch", { identity: { _tag: "RootCommit", sha: "abc" } });
const everything = [api, blog, scratch, shop];

function arrange(
  layout: Partial<ProjectLayout>,
  options: { readonly query?: string; readonly filtering?: boolean } = {},
) {
  const query = options.query ?? "";

  return arrangeProjects({
    repositories: everything,
    layout: { ...defaultProjectLayout, ...layout },
    matches: ({ label }) => label.includes(query),
    filtering: query !== "" || options.filtering === true,
    searching: query !== "",
  });
}

function titles(arrangement: ReturnType<typeof arrange>) {
  return arrangement.sections.map(({ section, repositories }) => [
    sectionTitle(section),
    repositories.map(({ label }) => label),
  ]);
}

describe("arrangeProjects", () => {
  it("lists every repository without headings when nothing is pinned or grouped", () => {
    const arrangement = arrange({});

    expect(arrangement.headed).toBe(false);
    expect(titles(arrangement)).toEqual([
      ["Other repositories", ["api", "blog", "scratch", "shop"]],
    ]);
  });

  it("puts pinned repositories first and shows each repository in only one section", () => {
    const arrangement = arrange({
      pinned: [shop.key],
      groups: [
        { id: work, name: "Work", repositories: [shop.key, api.key] },
        { id: tools, name: "Tools", repositories: [api.key, blog.key] },
      ],
    });

    expect(arrangement.headed).toBe(true);
    expect(titles(arrangement)).toEqual([
      ["Pinned", ["shop"]],
      ["Work", ["api"]],
      ["Tools", ["blog"]],
      ["Ungrouped", ["scratch"]],
    ]);
  });

  it("groups the rest by owner, with repositories that have no remote last", () => {
    expect(titles(arrange({ groupByOwner: true }))).toEqual([
      ["acme", ["api", "shop"]],
      ["me", ["blog"]],
      ["No remote", ["scratch"]],
    ]);
  });

  it("keeps an empty group visible until a search or filter hides it", () => {
    const empty = { groups: [{ id: work, name: "Work", repositories: [] }] };

    expect(titles(arrange(empty))[0]).toEqual(["Work", []]);
    expect(titles(arrange(empty, { filtering: true }))).toEqual([
      ["Ungrouped", ["api", "blog", "scratch", "shop"]],
    ]);
  });

  it("keeps the only section open once nothing is pinned or grouped", () => {
    const arrangement = arrange({ collapsed: ["rest"] });

    expect(arrangement.headed).toBe(false);
    expect(visibleRows(arrangement)).toHaveLength(everything.length);
  });

  it("opens collapsed sections while searching so every match shows", () => {
    const layout = {
      groups: [{ id: work, name: "Work", repositories: [shop.key] }],
      collapsed: [`group:${work}`],
    };

    expect(visibleRows(arrange(layout)).map(({ label }) => label)).toEqual([
      "api",
      "blog",
      "scratch",
    ]);
    expect(visibleRows(arrange(layout, { query: "sh" })).map(({ label }) => label)).toEqual([
      "shop",
    ]);
  });
});

describe("sortRepositories", () => {
  it("puts the newest commit on any branch first", () => {
    const old = repository("old", { committedAt: "2026-01-01T00:00:00Z" });

    const branchMoved = repository("branch-moved", {
      committedAt: "2026-01-01T00:00:00Z",
      git: {
        branches: {
          items: [
            {
              name: "feature",
              upstream: null,
              tip: {
                sha: "b",
                subject: "",
                committedAt: DateTime.makeUnsafe("2026-03-01T00:00:00Z"),
                merged: false,
                pushed: false,
                localCommits: 1,
              },
            },
          ],
          total: 1,
        },
      },
    });

    const recent = repository("recent", { committedAt: "2026-02-01T00:00:00Z" });

    expect(
      sortRepositories([old, recent, branchMoved], "updated").map(({ label }) => label),
    ).toEqual(["branch-moved", "recent", "old"]);
  });

  it("puts problems, then changes, then out-of-sync repositories before clean ones", () => {
    const clean = repository("clean");
    const changed = repository("changed", { git: { changed: { items: [], total: 2 } } });

    const behind = repository("behind", {
      git: {
        head: {
          _tag: "Branch",
          name: "main",
          upstream: { name: "origin/main", ahead: 0, behind: 3, gone: false },
        },
      },
    });

    const gone = repository("gone", {
      git: {
        head: {
          _tag: "Branch",
          name: "main",
          upstream: { name: "origin/main", ahead: 0, behind: 0, gone: true },
        },
      },
    });

    expect(
      sortRepositories([clean, behind, changed, gone], "attention").map(({ label }) => label),
    ).toEqual(["gone", "changed", "behind", "clean"]);
  });
});
