import { DateTime, Effect } from "effect";

import { deletedBranchPrefix } from "@fleetfrog/protocol/domain/checkout";

import { runGit } from "../process/runTool.ts";

import type { BranchTip, DeletedBranch, LocalBranch } from "@fleetfrog/protocol/domain/checkout";

import type { ParsedBranch } from "./parseBranches.ts";

/** Reads remote-tracking branches and FleetFrog's deleted branches in one pass. */
export const refFormat = [
  "%(refname)",
  "%(objectname)",
  "%(symref)",
  "%(committerdate:iso-strict)",
  "%(contents:subject)",
].join("%00");

export const refPatterns = ["refs/remotes", deletedBranchPrefix.replace(/\/$/, "")];

export interface ParsedRefs {
  /** Every remote-tracking branch, leaving out symbolic refs such as `origin/HEAD`. */
  readonly remoteRefs: ReadonlyArray<string>;
  /** The ref `origin/HEAD` points at, such as `refs/remotes/origin/main`. */
  readonly defaultRef: string | null;
  /** Newest first. */
  readonly deleted: ReadonlyArray<DeletedBranch>;
}

const deletedRef = /^refs\/fleetfrog\/deleted\/(\d+)\/(.+)$/;

/** Parses `git for-each-ref <refPatterns> --format=<refFormat>`. */
export function parseRefs(output: string): ParsedRefs {
  const remoteRefs: Array<string> = [];
  const deleted: Array<DeletedBranch> = [];
  let defaultRef: string | null = null;

  for (const line of output.split("\n")) {
    const [ref = "", sha = "", symref = "", , subject = ""] = line.split("\0");

    if (ref === "refs/remotes/origin/HEAD") {
      defaultRef = symref === "" ? null : symref;
    } else if (ref.startsWith("refs/remotes/") && symref === "") {
      remoteRefs.push(ref);
    } else {
      const match = deletedRef.exec(ref);

      if (match?.[1] !== undefined && match[2] !== undefined) {
        deleted.push({
          name: match[2],
          ref,
          sha,
          subject,
          deletedAt: DateTime.makeUnsafe(Number(match[1])),
        });
      }
    }
  }

  deleted.sort(
    (left, right) => right.deletedAt.epochMilliseconds - left.deletedAt.epochMilliseconds,
  );

  return { remoteRefs, defaultRef, deleted };
}

/** The local branches whose tips are in any of `refs`. */
const branchesIn = (directory: string, refs: ReadonlyArray<string>) =>
  refs.length === 0
    ? Effect.succeed(new Set<string>())
    : runGit(directory, [
        "for-each-ref",
        "refs/heads",
        "--format=%(refname:lstrip=2)",
        ...refs.map((ref) => `--merged=${ref}`),
      ]).pipe(Effect.map((output) => new Set(output.split("\n").filter((name) => name !== ""))));

/**
 * Counts of commits in no remote-tracking branch, by tip, for each repository. They only change
 * when the remote-tracking branches do, so status passes reuse them.
 */
const localCommitCache = new Map<
  string,
  { readonly remotes: string; readonly counts: Map<string, number> }
>();

const countLocalCommits = Effect.fn("countLocalCommits")(function* (options: {
  readonly directory: string;
  readonly commonDirectory: string;
  readonly remotes: string;
  readonly sha: string;
}) {
  const cached = localCommitCache.get(options.commonDirectory);
  const counts = cached?.remotes === options.remotes ? cached.counts : new Map<string, number>();

  localCommitCache.set(options.commonDirectory, { remotes: options.remotes, counts });

  const known = counts.get(options.sha);

  if (known !== undefined) {
    return known;
  }

  const output = yield* runGit(options.directory, [
    "rev-list",
    "--count",
    options.sha,
    "--not",
    "--remotes",
  ]);
  const count = Number(output.trim());

  counts.set(options.sha, count);

  return count;
});

/** Adds to each branch where its tip is: in the default branch, on a remote, or only here. */
export const readBranchTips = Effect.fn("readBranchTips")(function* (options: {
  readonly directory: string;
  readonly commonDirectory: string;
  readonly branches: ReadonlyArray<ParsedBranch>;
  readonly refs: ParsedRefs;
  /** The raw ref listing, which changes whenever a remote-tracking branch does. */
  readonly refOutput: string;
}) {
  const { refs } = options;
  const [merged, pushed] = yield* Effect.all(
    [
      branchesIn(options.directory, refs.defaultRef === null ? [] : [refs.defaultRef]),
      branchesIn(options.directory, refs.remoteRefs),
    ],
    { concurrency: 2 },
  );

  return yield* Effect.forEach(
    options.branches,
    ({ name, upstream, tip }) =>
      Effect.gen(function* () {
        const isPushed = pushed.has(name);
        const localCommits = isPushed
          ? 0
          : yield* countLocalCommits({
              directory: options.directory,
              commonDirectory: options.commonDirectory,
              remotes: options.refOutput,
              sha: tip.sha,
            });

        return {
          name,
          upstream,
          tip: {
            ...tip,
            merged: merged.has(name),
            pushed: isPushed,
            localCommits,
          } satisfies BranchTip,
        } satisfies LocalBranch;
      }),
    { concurrency: 4 },
  );
});
