import { createHash } from "node:crypto";
import path from "node:path";

import { Effect } from "effect";

import { countDetachedCommits } from "../actions/detachedCommits.ts";
import { exists } from "../actions/movableCheckout.ts";
import { listWorktrees, readLinkedWorktrees } from "../git/worktrees.ts";
import { diskUsage } from "../process/diskUsage.ts";
import { runGit, runGitAction } from "../process/runTool.ts";
import { ignoredListLimit, readIgnored, sized } from "./inspectCheckout.ts";

import type { WorktreeInspection } from "@fleetfrog/protocol/domain/trash";

import type { CheckoutLocation } from "../git/readCheckout.ts";

/** Changed and untracked paths from `git status --porcelain -z`, each counted once. */
function countStatus(listing: string) {
  const entries = listing.split("\0");
  let changedFiles = 0;
  let untrackedFiles = 0;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? "";

    if (entry.startsWith("?? ")) {
      untrackedFiles += 1;
    } else if (entry !== "") {
      changedFiles += 1;

      // A rename or copy is followed by its old path, which isn't a change of its own.
      if (/^[RC]|^.[RC]/.test(entry)) {
        index += 1;
      }
    }
  }

  return { changedFiles, untrackedFiles };
}

/**
 * Reads what removing the linked worktree at `worktree` would do, or returns null when the main
 * checkout at `location` no longer lists it. A worktree whose link to the repository broke, such
 * as after the main checkout moved, is repaired first so Git can read it.
 */
export const inspectWorktree = Effect.fn("inspectWorktree")(function* (
  location: Pick<CheckoutLocation, "path" | "commonDirectory">,
  worktree: string,
) {
  const found = (yield* readLinkedWorktrees(location)).find((listed) => listed.path === worktree);

  if (found === undefined) {
    return null;
  }

  const record = (yield* listWorktrees(location.path)).find((listed) => listed.path === worktree);
  const locked = record?.locked ?? null;
  const base = { path: worktree, branch: found.branch, locked };

  if (found.state === "Missing") {
    return {
      ...base,
      fingerprint: createHash("sha256")
        .update(["missing", locked ?? ""].join("\0"))
        .digest("hex"),
      missing: { parentMissing: !(yield* exists(path.dirname(worktree))) },
      changedFiles: 0,
      untrackedFiles: 0,
      unreachableCommits: 0,
      ignored: { items: [], total: 0 },
      caches: [],
    } satisfies WorktreeInspection;
  }

  if (found.state === "Broken") {
    yield* runGitAction({
      cwd: location.path,
      args: ["worktree", "repair", worktree],
      onOutput: () => undefined,
    });
  }

  const [head, commit, status] = yield* Effect.all(
    [
      runGit(worktree, ["rev-parse", "--symbolic-full-name", "HEAD"]),
      runGit(worktree, ["rev-parse", "--verify", "--quiet", "HEAD"]).pipe(
        Effect.orElseSucceed(() => ""),
      ),
      runGit(worktree, ["status", "--porcelain", "--untracked-files=all", "-z"]),
    ],
    { concurrency: "unbounded" },
  );

  const ignored = yield* readIgnored({ path: worktree });

  const [cacheSizes, otherSizes] = yield* Effect.all([
    diskUsage(worktree, ignored.caches),
    diskUsage(worktree, ignored.other),
  ]);

  const other = sized(ignored.other, otherSizes);

  return {
    ...base,
    fingerprint: createHash("sha256")
      .update(
        [head, commit, status, locked ?? "", ...ignored.other, "", ...ignored.caches].join("\0"),
      )
      .digest("hex"),
    missing: null,
    ...countStatus(status),
    unreachableCommits:
      found.branch === null
        ? yield* countDetachedCommits(worktree).pipe(Effect.orElseSucceed(() => 0))
        : 0,
    ignored: { items: other.slice(0, ignoredListLimit), total: other.length },
    caches: sized(ignored.caches, cacheSizes),
  } satisfies WorktreeInspection;
});
