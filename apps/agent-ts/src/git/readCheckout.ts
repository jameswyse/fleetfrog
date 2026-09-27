import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { DateTime, Effect, Option } from "effect";

import { Placement } from "@fleetfrog/protocol/domain/checkout";
import { RepositoryIdentity } from "@fleetfrog/protocol/domain/repositoryIdentity";

import { runGit } from "../process/runTool.ts";
import { parseRefs, readBranchTips, refFormat, refPatterns } from "./branchReach.ts";
import { branchFormat, parseBranches } from "./parseBranches.ts";
import { listLimit, parseStatus } from "./parseStatus.ts";
import { cloneableUrl, remoteIdentity } from "./remoteIdentity.ts";
import { readLinkedWorktrees } from "./worktrees.ts";

import type {
  Commit,
  GitStatus,
  Operation,
  Stash,
  Worktree,
} from "@fleetfrog/protocol/domain/checkout";

const stashLimit = 50;

/** What discovery learns about a checkout. It changes rarely, so status passes reuse it. */
export interface CheckoutLocation {
  readonly path: string;
  readonly identity: RepositoryIdentity;
  /** The main worktree's `origin`, in a form other machines can clone from. */
  readonly originUrl: string | null;
  readonly worktree: Worktree;
  readonly directoryName: string;
  readonly placement: Placement;
  /** This worktree's own Git directory, which holds its HEAD and any operation in progress. */
  readonly gitDirectory: string;
  readonly commonDirectory: string;
}

const readOrigin = (directory: string) =>
  runGit(directory, ["config", "--get", "remote.origin.url"]).pipe(Effect.option);

const identify = Effect.fn("identify")(function* (
  directory: string,
  origin: Option.Option<string>,
) {
  const fromRemote = Option.flatMap(origin, remoteIdentity);

  if (Option.isSome(fromRemote)) {
    return fromRemote;
  }

  const roots = yield* runGit(directory, ["rev-list", "--max-parents=0", "HEAD"]).pipe(
    Effect.option,
  );

  return Option.flatMap(roots, (output) =>
    Option.fromNullishOr(output.trim().split("\n").filter(Boolean).toSorted()[0]),
  ).pipe(Option.map((sha) => RepositoryIdentity.cases.RootCommit.make({ sha })));
});

const readStashes = Effect.fn("readStashes")(function* (directory: string) {
  const output = yield* runGit(directory, [
    "stash",
    "list",
    `--max-count=${stashLimit}`,
    "--format=%H%x00%gs",
  ]);

  return output
    .split("\n")
    .filter((line) => line !== "")
    .map((line, index): Stash => {
      const [sha = "", message = ""] = line.split("\0");

      return { index, message, sha };
    });
});

const readCommit = Effect.fn("readCommit")(function* (directory: string) {
  const output = yield* runGit(directory, ["log", "-1", "--format=%H%x00%cI%x00%s"]);
  const [sha = "", committedAt = "", subject = ""] = output.trimEnd().split("\0");

  return {
    sha,
    subject,
    committedAt: DateTime.makeUnsafe(committedAt).pipe(DateTime.toUtc),
  } satisfies Commit;
});

/**
 * When any worktree of the repository last fetched. `FETCH_HEAD` is per worktree, but every
 * worktree shares the remote-tracking refs a fetch updates.
 */
async function readLastFetch(commonDirectory: string): Promise<DateTime.Utc | null> {
  const linked = await readdir(path.join(commonDirectory, "worktrees")).catch(() => []);
  const times = await Promise.all(
    [commonDirectory, ...linked.map((name) => path.join(commonDirectory, "worktrees", name))].map(
      (directory) =>
        stat(path.join(directory, "FETCH_HEAD")).then(
          (fetchHead) => fetchHead.mtimeMs,
          () => null,
        ),
    ),
  );
  const latest = Math.max(...times.filter((time) => time !== null));

  return Number.isFinite(latest) ? DateTime.makeUnsafe(latest) : null;
}

/**
 * Identifies the working tree at `directory`. Returns `None` for bare repositories and for
 * repositories with neither an `origin` remote nor any commits, which have no identity to share.
 */
export const locateCheckout = Effect.fn("locateCheckout")(function* (directory: string) {
  const located = yield* runGit(directory, [
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
    "--git-dir",
    "--git-common-dir",
  ]).pipe(Effect.option);

  if (Option.isNone(located)) {
    return Option.none<CheckoutLocation>();
  }

  const [toplevel = "", gitDirectory = "", commonDirectory = ""] = located.value.trim().split("\n");
  const mainPath = gitDirectory === commonDirectory ? toplevel : path.dirname(commonDirectory);
  const worktree: Worktree =
    gitDirectory === commonDirectory ? { _tag: "Main" } : { _tag: "Linked", mainPath };
  // Worktrees share the main worktree's remote and history, so they share its identity. An orphan
  // or unborn branch in a linked worktree would otherwise split the repository.
  const mainOrigin = yield* readOrigin(mainPath);
  const fromMain = yield* identify(mainPath, mainOrigin);
  const identity =
    Option.isNone(fromMain) && mainPath !== toplevel
      ? yield* identify(toplevel, yield* readOrigin(toplevel))
      : fromMain;
  const originUrl = Option.getOrNull(Option.flatMap(mainOrigin, cloneableUrl));

  return Option.map(identity, (resolved) => ({
    path: toplevel,
    identity: resolved,
    originUrl,
    worktree,
    directoryName: path.basename(mainPath),
    // Discovery marks checkouts it finds in the Archive folder as archived.
    placement: Placement.cases.Projects.make({}),
    gitDirectory,
    commonDirectory,
  }));
});

/** The files Git leaves in a worktree's Git directory while each operation waits to continue. */
const operationMarkers: ReadonlyArray<readonly [string, Operation]> = [
  ["rebase-merge", "rebase"],
  ["rebase-apply", "rebase"],
  ["MERGE_HEAD", "merge"],
  ["CHERRY_PICK_HEAD", "cherry-pick"],
  ["REVERT_HEAD", "revert"],
  ["BISECT_LOG", "bisect"],
];

async function readOperation(gitDirectory: string): Promise<Operation | null> {
  const present = await Promise.all(
    operationMarkers.map(([marker]) =>
      stat(path.join(gitDirectory, marker)).then(
        () => true,
        () => false,
      ),
    ),
  );

  return operationMarkers.find((_, index) => present[index])?.[1] ?? null;
}

export const readGitStatus = Effect.fn("readGitStatus")(function* (location: CheckoutLocation) {
  const [statusOutput, branchOutput, refOutput, lastFetchedAt, operation] = yield* Effect.all(
    [
      runGit(location.path, [
        "status",
        "--porcelain=v2",
        "--branch",
        "--show-stash",
        "--untracked-files=normal",
        "-z",
      ]),
      runGit(location.path, ["for-each-ref", "refs/heads", `--format=${branchFormat}`]),
      runGit(location.path, ["for-each-ref", `--format=${refFormat}`, ...refPatterns]),
      Effect.promise(() => readLastFetch(location.commonDirectory)),
      Effect.promise(() => readOperation(location.gitDirectory)),
    ],
    { concurrency: "unbounded" },
  );
  const status = parseStatus(statusOutput);
  const { branches, currentCommit } = parseBranches(branchOutput);
  const refs = parseRefs(refOutput);
  const branchItems = yield* readBranchTips({
    directory: location.path,
    commonDirectory: location.commonDirectory,
    branches: branches.items,
    refs,
  });
  // Every worktree shares the clone's refs and worktree list, so only the main worktree reports
  // them.
  const main = location.worktree._tag === "Main";
  const deleted = main ? refs.deleted : [];
  const dropped = main ? refs.droppedStashes : [];
  const worktrees = main ? yield* readLinkedWorktrees(location) : [];
  const stashes = status.stashCount > 0 ? yield* readStashes(location.path) : [];
  const lastCommit =
    status.head._tag === "Detached" && status.commit !== null
      ? yield* readCommit(location.path)
      : currentCommit;

  return {
    head: status.head,
    operation,
    lastCommit,
    changed: status.changed,
    untracked: status.untracked,
    stashes: { items: stashes, total: status.stashCount },
    branches: { items: branchItems, total: branches.total },
    defaultBranch: refs.defaultRef?.replace(/^refs\/remotes\/origin\//, "") ?? null,
    deletedBranches: { items: deleted.slice(0, listLimit), total: deleted.length },
    droppedStashes: { items: dropped.slice(0, listLimit), total: dropped.length },
    worktrees,
    lastFetchedAt,
  } satisfies GitStatus;
});
