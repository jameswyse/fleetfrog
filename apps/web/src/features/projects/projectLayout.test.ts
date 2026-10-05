import { DateTime } from "effect";
import { describe, expect, it } from "vitest";

import { MachineId } from "@fleetfrog/protocol/domain/machine";
import { defaultProjectLayout, ProjectGroupId } from "@fleetfrog/protocol/domain/projectLayout";
import { repositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

import {
  deleteGroup,
  dropRepository,
  editGroup,
  moveToGroup,
  placeGroup,
} from "./layoutChanges.ts";
import { arrangeProjects, sectionTitle, sortRepositories, visibleRows } from "./projectLayout.ts";

import type { GitStatus } from "@fleetfrog/protocol/domain/checkout";
import type { Repository } from "@fleetfrog/protocol/domain/fleet";
import type { ProjectLayout } from "@fleetfrog/protocol/domain/projectLayout";
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

describe("dropRepository", () => {
  const layout: ProjectLayout = {
    ...defaultProjectLayout,
    pinned: [shop.key],
    groups: [{ id: work, name: "Work", repositories: [shop.key] }],
  };

  const sectionsOf = (current: ProjectLayout, dragging: Repository | null = null) =>
    arrangeProjects({
      repositories: everything,
      layout: current,
      matches: () => true,
      filtering: false,
      searching: false,
      dragging,
    }).sections;

  const target = (current: ProjectLayout, id: string) => {
    const found = sectionsOf(current).find((section) => section.id === id);

    if (found === undefined) {
      throw new Error(`No ${id} section`);
    }

    return found;
  };

  it("pins, moves into a group, or returns a repository to its own section", () => {
    expect(dropRepository(layout, api, target(layout, "pinned"))?.pinned).toEqual([
      shop.key,
      api.key,
    ]);

    const moved = dropRepository(layout, api, target(layout, `group:${work}`));

    expect(moved?.groups[0]?.repositories).toEqual([shop.key, api.key]);

    const returned = dropRepository(layout, shop, target(layout, "rest"));

    expect(returned?.pinned).toEqual([]);
    expect(returned?.groups[0]?.repositories).toEqual([]);
  });

  it("ignores a drop on the section the repository is already in", () => {
    expect(dropRepository(layout, shop, target(layout, "pinned"))).toBeNull();
    expect(dropRepository(layout, api, target(layout, "rest"))).toBeNull();
  });

  it("only returns a repository to its own owner's section", () => {
    const byOwner = { ...defaultProjectLayout, groupByOwner: true, pinned: [api.key] };

    expect(dropRepository(byOwner, api, target(byOwner, "owner:github.com/me"))).toBeNull();
    expect(dropRepository(byOwner, api, target(byOwner, "owner:github.com/acme"))?.pinned).toEqual(
      [],
    );
  });

  it("leaves the repository where it was if the group was deleted before the drop saved", () => {
    const workSection = target(layout, `group:${work}`);

    expect(dropRepository(deleteGroup(layout, work), shop, workSection)).toBeNull();
  });

  it("shows an empty Pinned section and the repository's own section while it is dragged", () => {
    const grouped: ProjectLayout = {
      ...defaultProjectLayout,
      groups: [{ id: work, name: "Work", repositories: everything.map(({ key }) => key) }],
    };

    expect(sectionsOf(grouped).map(({ id }) => id)).toEqual([`group:${work}`]);
    expect(sectionsOf(grouped, api).map(({ id }) => id)).toEqual([
      "pinned",
      `group:${work}`,
      "rest",
    ]);

    const byOwner = { ...grouped, groupByOwner: true };

    expect(sectionsOf(byOwner, blog).map(({ id }) => id)).toEqual([
      "pinned",
      `group:${work}`,
      "owner:github.com/me",
    ]);
  });
});

describe("layout changes", () => {
  const groups = [
    { id: work, name: "Work", repositories: [] },
    { id: tools, name: "Tools", repositories: [] },
  ];

  it("places a group beside another the same way however often it is applied", () => {
    const layout = { ...defaultProjectLayout, groups };
    const once = placeGroup(layout, work, { side: "After", targetId: tools });

    expect(once.groups.map(({ name }) => name)).toEqual(["Tools", "Work"]);
    expect(placeGroup(once, work, { side: "After", targetId: tools })).toEqual(once);
  });

  it("applies a group edit as additions and removals over changes made elsewhere", () => {
    const layout = {
      ...defaultProjectLayout,
      groups: [{ id: work, name: "Work", repositories: [shop.key, api.key] }],
    };

    const edited = editGroup(layout, {
      id: work,
      name: "Day job",
      members: [shop.key, blog.key],
      added: [blog.key],
      removed: [],
    });

    expect(edited.groups).toEqual([
      { id: work, name: "Day job", repositories: [shop.key, api.key, blog.key] },
    ]);
  });

  it("ignores a move into a group that no longer exists", () => {
    const layout = { ...defaultProjectLayout, groups };

    expect(
      moveToGroup(
        moveToGroup(layout, shop.key, work),
        shop.key,
        ProjectGroupId.make("9c8f6a52-7f9e-4c55-9a8e-2f4a1c9d3e10"),
      ),
    ).toEqual(moveToGroup(layout, shop.key, work));
  });
});
