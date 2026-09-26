import { stat } from "node:fs/promises";
import path from "node:path";

import { DateTime, Effect, Option } from "effect";

import { RepositoryIdentity } from "@fleetfrog/protocol/domain/repositoryIdentity";

import { runGit } from "../process/runCommand.ts";
import { branchFormat, parseBranches } from "./parseBranches.ts";
import { parseStatus } from "./parseStatus.ts";
import { remoteIdentity } from "./remoteIdentity.ts";

import type { Commit, GitStatus, Stash, Worktree } from "@fleetfrog/protocol/domain/checkout";

const stashLimit = 50;

/** What discovery learns about a checkout. It changes rarely, so status passes reuse it. */
export interface CheckoutLocation {
  readonly path: string;
  readonly identity: RepositoryIdentity;
  readonly worktree: Worktree;
  readonly directoryName: string;
  readonly commonDirectory: string;
}

const identify = Effect.fn("identify")(function* (directory: string) {
  const origin = yield* runGit(directory, ["config", "--get", "remote.origin.url"]).pipe(
    Effect.option,
  );
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
    "--format=%gs",
  ]);

  return output
    .split("\n")
    .filter((line) => line !== "")
    .map((message, index): Stash => ({ index, message }));
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
  const identity = yield* identify(toplevel);

  return Option.map(identity, (resolved) => ({
    path: toplevel,
    identity: resolved,
    worktree,
    directoryName: path.basename(mainPath),
    commonDirectory,
  }));
});

/** Reads the working tree state Git reports for a located checkout. */
export const readGitStatus = Effect.fn("readGitStatus")(function* (location: CheckoutLocation) {
  const [statusOutput, branchOutput, lastFetchedAt] = yield* Effect.all(
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
      Effect.promise(() =>
        stat(path.join(location.commonDirectory, "FETCH_HEAD")).then(
          (fetchHead) => DateTime.fromDateUnsafe(fetchHead.mtime),
          () => null,
        ),
      ),
    ],
    { concurrency: "unbounded" },
  );
  const status = parseStatus(statusOutput);
  const { branches, currentCommit } = parseBranches(branchOutput);
  const stashes = status.stashCount > 0 ? yield* readStashes(location.path) : [];
  const lastCommit =
    status.head._tag === "Detached" && status.commit !== null
      ? yield* readCommit(location.path)
      : currentCommit;

  return {
    head: status.head,
    lastCommit,
    changed: status.changed,
    untracked: status.untracked,
    stashes: { items: stashes, total: status.stashCount },
    branches,
    lastFetchedAt,
  } satisfies GitStatus;
});
