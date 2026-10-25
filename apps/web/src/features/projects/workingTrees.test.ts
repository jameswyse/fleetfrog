import { DateTime } from "effect";
import { describe, expect, it } from "vitest";

import { MachineId } from "@fleetfrog/protocol/domain/machine";

import { outlineCell } from "./workingTrees.ts";

import type {
  Checkout,
  GitStatus,
  LocalBranch,
  MergedPullRequest,
  Upstream,
} from "@fleetfrog/protocol/domain/checkout";
import type { Machine, MachineCheckout } from "@fleetfrog/protocol/domain/fleet";
import type { T3CodeThread } from "@fleetfrog/protocol/domain/t3Code";

const at = DateTime.makeUnsafe("2026-10-20T00:00:00Z");
const none = { items: [], total: 0 };
const studio = MachineId.make("aaaaaaaa-0000-4000-8000-000000000000");
const main = "/Users/dev/Projects/shop";

function machineWith(threads: ReadonlyArray<T3CodeThread> = []): Machine {
  return {
    id: studio,
    info: {
      hostname: "studio",
      prettyName: null,
      platform: "darwin",
      homeDirectory: "/Users/dev",
      agentVersion: "0.0.0",
      agentRuntime: "node",
      githubCli: { _tag: "Unavailable", reason: "" },
      system: null,
    },
    customName: null,
    customKind: null,
    connection: { _tag: "Offline", lastSeenAt: null },
    discoveryRoots: [],
    archiveFolder: null,
    archiveFolderStatus: null,
    lastDiscoveryAt: null,
    lastStatusAt: null,
    pairedAt: at,
    usage: null,
    update: null,
    t3CodeUpdate: null,
    trash: [],
    t3Code: {
      database: "/Users/dev/.t3/userdata/state.sqlite",
      reading: {
        _tag: "Read",
        schema: { migration: 54, name: "ProjectionThreadsAutoSettleDisabledAt" },
        projects: [],
        threads,
        threadCount: threads.length,
        unreadRecords: 0,
      },
      server: null,
      providers: [],
    },
  };
}

function branch(
  name: string,
  options: { readonly sha?: string; readonly merged?: boolean } = {},
): LocalBranch {
  return {
    name,
    upstream: { name: `origin/${name}`, ahead: 0, behind: 0, gone: false },
    tip: {
      sha: options.sha ?? `${name}-tip`,
      subject: name,
      committedAt: at,
      merged: options.merged ?? false,
      pushed: true,
      localCommits: 0,
    },
  };
}

const branches = [
  branch("main", { merged: true }),
  branch("fix/header", { sha: "f1" }),
  branch("feat/search"),
  branch("spike/cache"),
];

function entry(
  path: string,
  options: {
    readonly branch: string;
    readonly upstream?: Partial<Upstream>;
    readonly main?: string;
    readonly git?: Partial<GitStatus>;
    readonly merged?: ReadonlyArray<MergedPullRequest>;
  },
): MachineCheckout {
  const checkout: Checkout = {
    path,
    identity: { _tag: "Remote", host: "github.com", path: "acme/shop" },
    originUrl: null,
    directoryName: "shop",
    placement: { _tag: "Projects" },
    worktree:
      options.main === undefined ? { _tag: "Main" } : { _tag: "Linked", mainPath: options.main },
    status: {
      _tag: "Read",
      git: {
        head: {
          _tag: "Branch",
          name: options.branch,
          upstream: {
            name: `origin/${options.branch}`,
            ahead: 0,
            behind: 0,
            gone: false,
            ...options.upstream,
          },
        },
        operation: null,
        lastCommit: null,
        changed: none,
        untracked: none,
        stashes: none,
        branches: { items: branches, total: branches.length },
        defaultBranch: "main",
        deletedBranches: none,
        droppedStashes: none,
        worktrees: [],
        lastFetchedAt: null,
        ...options.git,
      },
    },
    github: {
      defaultBranch: "main",
      remoteSha: "a",
      trackingSha: "a",
      pullRequests: [],
      mergedPullRequests: options.merged ?? [],
      checkedAt: at,
    },
    scannedAt: at,
  };

  return { machineId: studio, checkout };
}

const mergedFix = {
  number: 41,
  url: "https://github.com/acme/shop/pull/41",
  branch: "fix/header",
  sha: "f1",
};

describe("outlineCell", () => {
  it("nests each clone's worktrees under it and parks only branches no working tree has checked out", () => {
    const outline = outlineCell({
      machine: machineWith(),
      ignoredBranches: [],
      entries: [
        entry(main, {
          branch: "main",
          git: {
            worktrees: [
              { path: "/Users/dev/wt/header", branch: "fix/header", state: "Present" },
              { path: "/Users/dev/wt/gone", branch: "feat/search", state: "Missing" },
            ],
          },
        }),
        entry("/Users/dev/wt/header", { branch: "fix/header", main }),
        entry("/Users/dev/Other/shop", { branch: "main" }),
      ],
    });

    expect(
      outline.map((clone) => ({
        path: clone.path,
        main: clone.main?.path,
        linked: clone.linked.map(({ path, presence }) => ({ path, presence })),
        parked: clone.parked.map(({ name }) => name),
      })),
    ).toStrictEqual([
      {
        path: main,
        main,
        linked: [
          { path: "/Users/dev/wt/header", presence: "Present" },
          { path: "/Users/dev/wt/gone", presence: "Missing" },
        ],
        parked: ["spike/cache"],
      },
      {
        path: "/Users/dev/Other/shop",
        main: "/Users/dev/Other/shop",
        linked: [],
        parked: ["fix/header", "feat/search", "spike/cache"],
      },
    ]);
  });

  it("finishes a clean worktree once its pull request merged at the branch's tip", () => {
    const [clone] = outlineCell({
      machine: machineWith(),
      ignoredBranches: [],
      entries: [
        entry(main, { branch: "main" }),
        entry("/Users/dev/wt/header", {
          branch: "fix/header",
          main,
          upstream: { gone: true },
          merged: [mergedFix],
        }),
      ],
    });

    expect(clone?.linked[0]?.lifecycle).toStrictEqual({ _tag: "Finished", pullRequest: 41 });
  });

  it("finishes a clean worktree merged into the default branch once its remote branch is gone", () => {
    const [clone] = outlineCell({
      machine: machineWith(),
      ignoredBranches: [],
      entries: [
        entry(main, { branch: "main" }),
        entry("/Users/dev/wt/search", {
          branch: "feat/search",
          main,
          upstream: { gone: true },
          git: {
            branches: { items: [branch("feat/search", { merged: true })], total: 1 },
          },
        }),
      ],
    });

    expect(clone?.linked[0]?.lifecycle).toStrictEqual({ _tag: "Finished", pullRequest: null });
  });

  it("only suspects a worktree is finished when its remote branch is gone without a matching merge", () => {
    const [clone] = outlineCell({
      machine: machineWith(),
      ignoredBranches: [],
      entries: [
        entry(main, { branch: "main" }),
        entry("/Users/dev/wt/header", {
          branch: "fix/header",
          main,
          upstream: { gone: true },
          merged: [{ ...mergedFix, sha: "an-earlier-commit" }],
        }),
      ],
    });

    expect(clone?.linked[0]?.lifecycle).toStrictEqual({ _tag: "RemoteGone" });
  });

  it("keeps a merged worktree active while it has changes or T3 Code is working in it", () => {
    const finishedButDirty = entry("/Users/dev/wt/header", {
      branch: "fix/header",
      main,
      upstream: { gone: true },
      merged: [mergedFix],
      git: { untracked: { items: ["notes.md"], total: 1 } },
    });

    const finishedButBusy = entry("/Users/dev/wt/search", {
      branch: "feat/search",
      main,
      upstream: { gone: true },
      git: { branches: { items: [branch("feat/search", { merged: true })], total: 1 } },
    });

    const [clone] = outlineCell({
      machine: machineWith([
        {
          id: "t1",
          projectId: "p1",
          title: "Polish search",
          path: "/Users/dev/wt/search",
          worktree: true,
          state: "Working",
          archived: false,
          updatedAt: at,
        },
      ]),
      ignoredBranches: [],
      entries: [entry(main, { branch: "main" }), finishedButDirty, finishedButBusy],
    });

    expect(clone?.linked.map(({ lifecycle }) => lifecycle._tag)).toStrictEqual([
      "Active",
      "Active",
    ]);
  });

  it("never finishes a worktree on a branch the cleanup settings ignore", () => {
    const [clone] = outlineCell({
      machine: machineWith(),
      ignoredBranches: ["fix/header"],
      entries: [
        entry(main, { branch: "main" }),
        entry("/Users/dev/wt/header", {
          branch: "fix/header",
          main,
          upstream: { gone: true },
          merged: [mergedFix],
        }),
      ],
    });

    expect(clone?.linked[0]?.lifecycle).toStrictEqual({ _tag: "Active" });
  });
});
