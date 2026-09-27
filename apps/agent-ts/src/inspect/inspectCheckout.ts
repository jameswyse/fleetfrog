import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { Duration, Effect } from "effect";

import { RemoteCheck } from "@fleetfrog/protocol/domain/trash";

import { readGitStatus } from "../git/readCheckout.ts";
import { countLinkedWorktrees } from "../git/worktrees.ts";
import { diskUsage } from "../process/diskUsage.ts";
import { runGit, runGitAction } from "../process/runTool.ts";

import type { Inspection, SizedPath } from "@fleetfrog/protocol/domain/trash";

import type { CheckoutLocation } from "../git/readCheckout.ts";
import type { CommandFailed } from "../process/runTool.ts";

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

/** Build output with a name of its own, such as `.next-e2e` for a second Next.js build. */
const cachePrefixes = [".next-"];
const cacheSuffixes = [".tsbuildinfo", ".pyc"];

function isCache(entry: string): boolean {
  const name = path.posix.basename(entry.replace(/\/$/, ""));

  return (
    cacheNames.has(name) ||
    cachePrefixes.some((prefix) => name.startsWith(prefix)) ||
    cacheSuffixes.some((suffix) => name.endsWith(suffix))
  );
}

/** How many ignored entries the dashboard lists by name. */
export const ignoredListLimit = 100;
const fetchTimeout = Duration.seconds(90);

/** Ignored files and folders, each folder once rather than everything inside it. */
const listIgnored = (location: Pick<CheckoutLocation, "path">) =>
  runGit(location.path, [
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-standard",
    "--directory",
    "--no-empty-directory",
    "-z",
  ]).pipe(Effect.map((output) => output.split("\0").filter((entry) => entry !== "")));

export interface IgnoredEntries {
  readonly caches: ReadonlyArray<string>;
  readonly other: ReadonlyArray<string>;
}

/** Whether the inspection may fetch, which the owner allows with the `git` tier. */
export interface InspectionOptions {
  readonly fetch: "Allowed" | "NotAllowed";
}

/** The ignored entries that are caches, and those that are anything else. */
export const readIgnored = (
  location: Pick<CheckoutLocation, "path">,
): Effect.Effect<IgnoredEntries, CommandFailed> =>
  listIgnored(location).pipe(
    Effect.map((entries) => ({
      caches: entries.filter(isCache),
      other: entries.filter((entry) => !isCache(entry)),
    })),
  );

/**
 * A digest of what the checkout holds: HEAD, every ref other than remote-tracking branches, each
 * changed or untracked path, and each ignored entry, caches included, so a cache that appears after
 * the inspection isn't deleted unseen. Remote-tracking branches are left out, so fetching doesn't
 * change it.
 */
export const fingerprintCheckout = Effect.fn("fingerprintCheckout")(function* (
  location: CheckoutLocation,
  ignored: IgnoredEntries,
) {
  const [head, refs, status] = yield* Effect.all(
    [
      runGit(location.path, ["rev-parse", "--symbolic-full-name", "HEAD"]).pipe(
        Effect.orElseSucceed(() => "unborn"),
      ),
      runGit(location.path, ["for-each-ref", "--format=%(refname) %(objectname)"]).pipe(
        Effect.map((listing) =>
          listing
            .split("\n")
            .filter((line) => !line.startsWith("refs/remotes/"))
            .join("\n"),
        ),
      ),
      runGit(location.path, ["status", "--porcelain=v2", "--untracked-files=all", "-z"]),
    ],
    { concurrency: "unbounded" },
  );
  const commit = yield* runGit(location.path, ["rev-parse", "--verify", "--quiet", "HEAD"]).pipe(
    Effect.orElseSucceed(() => ""),
  );

  return createHash("sha256")
    .update([head, commit, refs, status, ...ignored.other, "", ...ignored.caches].join("\0"))
    .digest("hex");
});

/** Fetches every remote so the inspection compares against what they have now. */
const checkRemotes = (location: CheckoutLocation, options: InspectionOptions) =>
  Effect.gen(function* () {
    const remotes = (yield* runGit(location.path, ["remote"])).trim();

    if (remotes === "") {
      return RemoteCheck.cases.NoRemote.make({});
    }

    if (options.fetch === "NotAllowed") {
      return RemoteCheck.cases.Unreachable.make({
        message: "Git actions are turned off on this machine, so its remotes weren't fetched",
      });
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

/** Tags no remote has, found by asking each remote for its tags. */
const countUnpushedTags = (location: CheckoutLocation) =>
  Effect.gen(function* () {
    const local = (yield* runGit(location.path, [
      "for-each-ref",
      "--format=%(refname)",
      "refs/tags",
    ]))
      .split("\n")
      .filter((ref) => ref !== "");

    if (local.length === 0) {
      return 0;
    }

    const remotes = (yield* runGit(location.path, ["remote"])).split("\n").filter(Boolean);
    const onRemotes = new Set<string>();

    for (const remote of remotes) {
      let listing = "";

      yield* runGitAction({
        cwd: location.path,
        args: ["ls-remote", "--tags", "--refs", remote],
        onOutput: (text) => {
          listing += text;
        },
      });

      // Only lines in `ls-remote`'s own format count, so a warning on stderr is never a tag.
      for (const match of listing.matchAll(/^[0-9a-f]{40,64}\t(refs\/tags\/\S+)$/gm)) {
        if (match[1] !== undefined) {
          onRemotes.add(match[1]);
        }
      }
    }

    return local.filter((ref) => !onRemotes.has(ref)).length;
  });

/** Submodules whose Git directories are inside the checkout, holding work of their own. */
const countSubmodules = (location: CheckoutLocation) =>
  Effect.promise(() =>
    readdir(path.join(location.commonDirectory, "modules")).then(
      (entries) => entries.length,
      () => 0,
    ),
  );

/** Each path with its size, largest first. */
export function sized(
  paths: ReadonlyArray<string>,
  sizes: ReadonlyArray<number>,
): Array<SizedPath> {
  return paths
    .map((entry, index) => ({ path: entry, sizeBytes: sizes[index] ?? 0 }))
    .toSorted((left, right) => right.sizeBytes - left.sizeBytes);
}

/**
 * Finds what deleting the checkout would lose. It fetches every remote first, when allowed, so
 * commits count as safe only if a remote has them now.
 */
export const inspectCheckout = Effect.fn("inspectCheckout")(function* (
  location: CheckoutLocation,
  options: InspectionOptions,
) {
  const remote = yield* checkRemotes(location, options);
  const git = yield* readGitStatus(location);
  // Every ref counts, including notes and the trash's, and HEAD too, since a detached HEAD can
  // hold commits no branch has. Stashes are counted on their own.
  const unpushedCommits = Number(
    (yield* runGit(location.path, [
      "rev-list",
      "--count",
      "--exclude=refs/stash",
      "--all",
      ...(git.head._tag === "Unborn" ? [] : ["HEAD"]),
      "--not",
      "--remotes",
    ])).trim(),
  );
  const unpushedTags =
    remote._tag === "Fetched"
      ? yield* countUnpushedTags(location).pipe(Effect.orElseSucceed(() => 0))
      : 0;
  const ignored = yield* readIgnored(location);
  const [[total = 0], cacheSizes, otherSizes] = yield* Effect.all([
    diskUsage(path.dirname(location.path), [path.basename(location.path)]),
    diskUsage(location.path, ignored.caches),
    diskUsage(location.path, ignored.other),
  ]);
  const other = sized(ignored.other, otherSizes);

  return {
    fingerprint: yield* fingerprintCheckout(location, ignored),
    sizeBytes: total,
    remote,
    unpushedBranches: git.branches.items.flatMap(({ name, tip }) =>
      tip.localCommits > 0 ? [{ name, commits: tip.localCommits }] : [],
    ),
    unpushedCommits,
    unpushedTags,
    operation: git.operation,
    submodules: yield* countSubmodules(location),
    stashes: git.stashes.total,
    changedFiles: git.changed.total,
    untrackedFiles: git.untracked.total,
    ignored: { items: other.slice(0, ignoredListLimit), total: other.length },
    caches: sized(ignored.caches, cacheSizes),
    linkedWorktrees: location.worktree._tag === "Main" ? yield* countLinkedWorktrees(location) : 0,
  } satisfies Inspection;
});
