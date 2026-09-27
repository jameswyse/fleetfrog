import path from "node:path";

import { Effect } from "effect";

import { ActionResult, SkipReason } from "@fleetfrog/protocol/domain/action";

import { readLinkedWorktrees } from "../git/worktrees.ts";
import { readIgnored } from "../inspect/inspectCheckout.ts";
import { runGit, runGitAction } from "../process/runTool.ts";
import { exists } from "./movableCheckout.ts";
import { failedWith, skipped, succeeded } from "./outcomes.ts";

import type { CheckoutLocation } from "../git/readCheckout.ts";
import type { ActionOutput } from "./actionOutput.ts";

/**
 * Removes a linked worktree of the main checkout, keeping its branch. One whose folder is gone is
 * only forgotten, and only while the folder above it exists, so a worktree on a disk that isn't
 * mounted is left alone. One whose link broke, such as after the main checkout moved, is repaired
 * first. Nothing is removed while the worktree has changes, untracked files, commits that only
 * its detached HEAD holds, or ignored files other than caches, so only rebuildable files go.
 */
export const removeWorktree = Effect.fn("removeWorktree")(
  function* (location: CheckoutLocation, worktree: string, output: ActionOutput) {
    const found = (yield* readLinkedWorktrees(location)).find((listed) => listed.path === worktree);

    if (found === undefined) {
      return skipped(SkipReason.cases.NoSuchWorktree.make({}));
    }

    if (found.state === "Missing") {
      if (!(yield* exists(path.dirname(worktree)))) {
        return skipped(SkipReason.cases.NoSuchWorktree.make({}));
      }

      // Its folder is gone, so forcing only removes Git's record of it.
      yield* runGitAction({
        cwd: location.path,
        args: ["worktree", "remove", "--force", worktree],
        onOutput: output.write,
      });

      return succeeded(ActionResult.cases.WorktreeRemoved.make({}));
    }

    if (found.state === "Broken") {
      yield* runGitAction({
        cwd: location.path,
        args: ["worktree", "repair", worktree],
        onOutput: output.write,
      });
    }

    const changes = (yield* runGit(worktree, ["status", "--porcelain", "--untracked-files=normal"]))
      .split("\n")
      .filter((line) => line !== "").length;

    if (changes > 0) {
      return skipped(SkipReason.cases.UncommittedChanges.make({ files: changes }));
    }

    // A branch keeps its commits, but a detached HEAD's own commits would become unreachable.
    const unreachable = Number(
      (yield* runGit(worktree, [
        "rev-list",
        "--count",
        "HEAD",
        "--not",
        "--branches",
        "--tags",
        "--remotes",
        "--glob=refs/fleetfrog/*",
      ])).trim(),
    );

    if (unreachable > 0) {
      return skipped(SkipReason.cases.UnreachableCommits.make({ commits: unreachable }));
    }

    const ignored = yield* readIgnored({ path: worktree });

    if (ignored.other.length > 0) {
      return skipped(SkipReason.cases.IgnoredFiles.make({ files: ignored.other.length }));
    }

    yield* runGitAction({
      cwd: location.path,
      args: ["worktree", "remove", worktree],
      onOutput: output.write,
    });

    return succeeded(ActionResult.cases.WorktreeRemoved.make({}));
  },
  Effect.catchTag("CommandFailed", failedWith),
);
