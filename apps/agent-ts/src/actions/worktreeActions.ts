import { DateTime, Effect } from "effect";

import { ActionResult, SkipReason } from "@fleetfrog/protocol/domain/action";

import { inspectWorktree } from "../inspect/inspectWorktree.ts";
import { runGitAction } from "../process/runTool.ts";
import { keepDetachedCommits } from "./detachedCommits.ts";
import { stashDate } from "./gitActions.ts";
import { failedWith, skipped, succeeded } from "./outcomes.ts";

import type { WorktreeInspection } from "@fleetfrog/protocol/domain/trash";

import type { CheckoutLocation } from "../git/readCheckout.ts";
import type { ActionOutput } from "./actionOutput.ts";

/** Git needs forcing twice to remove a locked worktree, and once to forget a missing one. */
function forceFlags(inspection: WorktreeInspection): ReadonlyArray<string> {
  if (inspection.locked !== null) {
    return ["--force", "--force"];
  }

  return inspection.missing === null ? [] : ["--force"];
}

/**
 * Removes a linked worktree of the main checkout, keeping its branch, if it still matches the
 * inspection the dashboard showed. Its changes and untracked files are stashed first, and commits
 * only its detached HEAD holds go to the trash, so only its ignored files are lost. One whose
 * folder is gone is only forgotten, and a locked one is unlocked, both as the dashboard warned.
 */
export const removeWorktree = Effect.fn("removeWorktree")(
  function* (
    location: Pick<CheckoutLocation, "path" | "commonDirectory">,
    options: { readonly worktree: string; readonly fingerprint: string },
    output: ActionOutput,
  ) {
    const { worktree } = options;
    const inspection = yield* inspectWorktree(location, worktree);

    if (inspection === null) {
      return skipped(SkipReason.cases.NoSuchWorktree.make({}));
    }

    if (inspection.fingerprint !== options.fingerprint) {
      return skipped(SkipReason.cases.ChangedSinceInspection.make({}));
    }

    const force = forceFlags(inspection);
    const stashedFiles = inspection.changedFiles + inspection.untrackedFiles;

    if (stashedFiles > 0) {
      yield* runGitAction({
        cwd: worktree,
        args: [
          "stash",
          "push",
          "--include-untracked",
          "--message",
          `Stashed from FleetFrog before removing the worktree at ${worktree} on ${stashDate(yield* DateTime.now)}`,
        ],
        onOutput: output.write,
      });
    }

    const savedCommits =
      inspection.unreachableCommits > 0 ? yield* keepDetachedCommits(worktree, output) : 0;

    yield* runGitAction({
      cwd: location.path,
      args: ["worktree", "remove", ...force, worktree],
      onOutput: output.write,
    });

    return succeeded(
      ActionResult.cases.WorktreeRemoved.make({
        stashedFiles,
        savedCommits,
        deletedIgnored: inspection.ignored.total,
      }),
    );
  },
  Effect.catchTag("CommandFailed", failedWith),
);
