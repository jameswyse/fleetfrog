import { Effect } from "effect";

import { ActionResult, SkipReason } from "@fleetfrog/protocol/domain/action";

import { readLinkedWorktrees } from "../git/worktrees.ts";
import { runGit, runGitAction } from "../process/runTool.ts";
import { failedWith, skipped, succeeded } from "./outcomes.ts";

import type { CheckoutLocation } from "../git/readCheckout.ts";
import type { ActionOutput } from "./actionOutput.ts";

/**
 * Removes a linked worktree of the main checkout, keeping its branch. One whose folder is gone is
 * only forgotten. One whose link broke, such as after the main checkout moved, is repaired first.
 * Git refuses to remove a worktree with changes or untracked files, and this checks for them
 * before asking, so only files Git ignores are deleted with it.
 */
export const removeWorktree = Effect.fn("removeWorktree")(
  function* (location: CheckoutLocation, worktree: string, output: ActionOutput) {
    const found = (yield* readLinkedWorktrees(location)).find(({ path }) => path === worktree);

    if (found === undefined) {
      return skipped(SkipReason.cases.NoSuchWorktree.make({}));
    }

    if (found.state === "Missing") {
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

    yield* runGitAction({
      cwd: location.path,
      args: ["worktree", "remove", worktree],
      onOutput: output.write,
    });

    return succeeded(ActionResult.cases.WorktreeRemoved.make({}));
  },
  Effect.catchTag("CommandFailed", failedWith),
);
