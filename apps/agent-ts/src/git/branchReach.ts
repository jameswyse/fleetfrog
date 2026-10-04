import { DateTime, Effect } from "effect";

import {
  deletedBranchPrefix,
  droppedStashPrefix,
  parseDeletedRef,
  parseDroppedStashRef,
} from "@fleetfrog/protocol/domain/checkout";

import { runGit } from "../process/runTool.ts";

import type { DeletedBranch, DroppedStash, LocalBranch } from "@fleetfrog/protocol/domain/checkout";

import type { ParsedBranch } from "./parseBranches.ts";

export const refFormat = [
  "%(refname)",
  "%(objectname)",
  "%(symref)",
  "%(committerdate:iso-strict)",
  "%(contents:subject)",
].join("%00");

export const refPatterns = [
  "refs/remotes",
  deletedBranchPrefix.replace(/\/$/, ""),
  droppedStashPrefix.replace(/\/$/, ""),
];

export interface ParsedRefs {
  readonly remoteRefs: ReadonlyArray<string>;
  readonly defaultRef: string | null;
  readonly deleted: ReadonlyArray<DeletedBranch>;
  readonly droppedStashes: ReadonlyArray<DroppedStash>;
}

export function parseRefs(output: string): ParsedRefs {
  const remoteRefs: Array<string> = [];
  const deleted: Array<DeletedBranch> = [];
  const droppedStashes: Array<DroppedStash> = [];
  let defaultRef: string | null = null;

  for (const line of output.split("\n")) {
    const [ref = "", sha = "", symref = "", , subject = ""] = line.split("\0");

    if (ref === "refs/remotes/origin/HEAD") {
      defaultRef = symref === "" ? null : symref;
    } else if (ref.startsWith("refs/remotes/") && symref === "") {
      remoteRefs.push(`${ref} ${sha}`);
    } else {
      const parsed = parseDeletedRef(ref);
      const dropped = parseDroppedStashRef(ref);

      if (dropped !== null) {
        droppedStashes.push({
          ref,
          sha,
          message: subject,
          droppedAt: DateTime.makeUnsafe(dropped.droppedAtMillis),
        });
      } else if (parsed !== null) {
        deleted.push({
          name: parsed.name,
          ref,
          sha,
          subject,
          deletedAt: DateTime.makeUnsafe(parsed.deletedAtMillis),
        });
      }
    }
  }

  deleted.sort(
    (left, right) => right.deletedAt.epochMilliseconds - left.deletedAt.epochMilliseconds,
  );

  droppedStashes.sort(
    (left, right) => right.droppedAt.epochMilliseconds - left.droppedAt.epochMilliseconds,
  );

  return { remoteRefs, defaultRef, deleted, droppedStashes };
}

const branchesIn = (directory: string, ref: string | null) =>
  ref === null
    ? Effect.succeed(new Set<string>())
    : runGit(directory, [
        "for-each-ref",
        "refs/heads",
        "--format=%(refname:lstrip=2)",
        `--merged=${ref}`,
      ]).pipe(Effect.map((output) => new Set(output.split("\n").filter((name) => name !== ""))));

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

export const readBranchTips = Effect.fn("readBranchTips")(function* (options: {
  readonly directory: string;
  readonly commonDirectory: string;
  readonly branches: ReadonlyArray<ParsedBranch>;
  readonly refs: ParsedRefs;
}) {
  const merged = yield* branchesIn(options.directory, options.refs.defaultRef);
  const remotes = options.refs.remoteRefs.join("\n");

  return yield* Effect.forEach(
    options.branches,
    ({ name, upstream, tip }) =>
      countLocalCommits({
        directory: options.directory,
        commonDirectory: options.commonDirectory,
        remotes,
        sha: tip.sha,
      }).pipe(
        Effect.map(
          (localCommits) =>
            ({
              name,
              upstream,
              tip: { ...tip, merged: merged.has(name), pushed: localCommits === 0, localCommits },
            }) satisfies LocalBranch,
        ),
      ),
    { concurrency: 4 },
  );
});
