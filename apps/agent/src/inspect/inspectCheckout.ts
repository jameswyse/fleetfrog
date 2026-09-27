import { createHash } from "node:crypto";
import path from "node:path";

import { Duration, Effect } from "effect";

import { RemoteCheck } from "@fleetfrog/protocol/domain/trash";

import { readGitStatus } from "../git/readCheckout.ts";
import { diskUsage } from "../process/diskUsage.ts";
import { runGit, runGitAction } from "../process/runTool.ts";

import type { Inspection, SizedPath } from "@fleetfrog/protocol/domain/trash";

import type { CheckoutLocation } from "../git/readCheckout.ts";

/**
 * Ignored folders and files that tools rebuild or recreate, such as dependencies, build output and
 * caches. Only ignored entries with these names count, so a tracked `build` folder never does.
 */
const cacheNames = new Set([
  "node_modules",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".parcel-cache",
  ".vite",
  ".cache",
  ".expo",
  "dist",
  "build",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".gradle",
  "coverage",
  ".nyc_output",
  "DerivedData",
  "Pods",
  ".dart_tool",
  ".eslintcache",
  ".DS_Store",
]);

const cacheSuffixes = [".tsbuildinfo", ".pyc"];

function isCache(entry: string): boolean {
  const name = path.posix.basename(entry.replace(/\/$/, ""));

  return cacheNames.has(name) || cacheSuffixes.some((suffix) => name.endsWith(suffix));
}

/** How many ignored entries the dashboard lists by name. */
const ignoredListLimit = 100;
const fetchTimeout = Duration.seconds(90);

/** Ignored files and folders, each folder once rather than everything inside it. */
const listIgnored = (location: CheckoutLocation) =>
  runGit(location.path, [
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-standard",
    "--directory",
    "--no-empty-directory",
    "-z",
  ]).pipe(Effect.map((output) => output.split("\0").filter((entry) => entry !== "")));

/** The ignored entries that are caches, and those that are anything else. */
export const readIgnored = (location: CheckoutLocation) =>
  listIgnored(location).pipe(
    Effect.map((entries) => ({
      caches: entries.filter(isCache),
      other: entries.filter((entry) => !isCache(entry)),
    })),
  );

/**
 * A digest of everything deleting the checkout could lose: HEAD, every branch, tag, stash and
 * deleted branch, each change and untracked file, and each ignored entry that isn't a cache.
 * Remote-tracking branches are left out, so fetching doesn't change it.
 */
export const fingerprintCheckout = Effect.fn("fingerprintCheckout")(function* (
  location: CheckoutLocation,
  ignored: ReadonlyArray<string>,
) {
  const [head, refs, status] = yield* Effect.all(
    [
      runGit(location.path, ["rev-parse", "--symbolic-full-name", "HEAD"]).pipe(
        Effect.orElseSucceed(() => "unborn"),
      ),
      runGit(location.path, [
        "for-each-ref",
        "--format=%(refname) %(objectname)",
        "refs/heads",
        "refs/tags",
        "refs/stash",
        "refs/fleetfrog",
      ]),
      runGit(location.path, ["status", "--porcelain=v2", "--untracked-files=all", "-z"]),
    ],
    { concurrency: "unbounded" },
  );
  const commit = yield* runGit(location.path, ["rev-parse", "--verify", "--quiet", "HEAD"]).pipe(
    Effect.orElseSucceed(() => ""),
  );

  return createHash("sha256")
    .update([head, commit, refs, status, ...ignored].join("\0"))
    .digest("hex");
});

/** Fetches every remote so the inspection compares against what they have now. */
const checkRemotes = (location: CheckoutLocation) =>
  Effect.gen(function* () {
    const remotes = (yield* runGit(location.path, ["remote"])).trim();

    if (remotes === "") {
      return RemoteCheck.cases.NoRemote.make({});
    }

    return yield* runGitAction({
      cwd: location.path,
      args: ["fetch", "--all", "--prune", "--no-prune-tags"],
      onOutput: () => undefined,
    }).pipe(
      Effect.timeoutOrElse({
        duration: fetchTimeout,
        orElse: () =>
          Effect.succeed(
            RemoteCheck.cases.Unreachable.make({ message: "Fetching took too long." }),
          ),
      }),
      Effect.map((fetched) => fetched ?? RemoteCheck.cases.Fetched.make({})),
      Effect.catchTag("CommandFailed", ({ message }) =>
        Effect.succeed(RemoteCheck.cases.Unreachable.make({ message })),
      ),
    );
  });

/** Linked worktrees of the repository that still exist. */
export const countLinkedWorktrees = (location: CheckoutLocation) =>
  runGit(location.path, ["worktree", "list", "--porcelain"]).pipe(
    Effect.map(
      (output) =>
        output
          .split("\n\n")
          .filter((record) => record.trim() !== "" && !record.includes("\nprunable")).length - 1,
    ),
  );

function sized(paths: ReadonlyArray<string>, sizes: ReadonlyArray<number>): Array<SizedPath> {
  return paths
    .map((entry, index) => ({ path: entry, sizeBytes: sizes[index] ?? 0 }))
    .toSorted((left, right) => right.sizeBytes - left.sizeBytes);
}

/**
 * Finds what deleting the checkout would lose. It fetches every remote first, so commits count as
 * safe only if a remote has them now.
 */
export const inspectCheckout = Effect.fn("inspectCheckout")(function* (location: CheckoutLocation) {
  const remote = yield* checkRemotes(location);
  const git = yield* readGitStatus(location);
  const unpushedCommits = Number(
    (yield* runGit(location.path, [
      "rev-list",
      "--count",
      "--branches",
      "--tags",
      "--glob=refs/fleetfrog/*",
      "--not",
      "--remotes",
    ])).trim(),
  );
  const ignored = yield* readIgnored(location);
  const [[total = 0], cacheSizes, otherSizes] = yield* Effect.all([
    diskUsage(path.dirname(location.path), [path.basename(location.path)]),
    diskUsage(location.path, ignored.caches),
    diskUsage(location.path, ignored.other),
  ]);
  const other = sized(ignored.other, otherSizes);

  return {
    fingerprint: yield* fingerprintCheckout(location, ignored.other),
    sizeBytes: total,
    remote,
    unpushedBranches: git.branches.items.flatMap(({ name, tip }) =>
      tip.localCommits > 0 ? [{ name, commits: tip.localCommits }] : [],
    ),
    unpushedCommits,
    stashes: git.stashes.total,
    changedFiles: git.changed.total,
    untrackedFiles: git.untracked.total,
    ignored: { items: other.slice(0, ignoredListLimit), total: other.length },
    caches: sized(ignored.caches, cacheSizes),
    linkedWorktrees: location.worktree._tag === "Main" ? yield* countLinkedWorktrees(location) : 0,
  } satisfies Inspection;
});
