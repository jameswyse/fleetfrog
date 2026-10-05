import { DateTime, Effect } from "effect";

import { ActionResult, SkipReason } from "@fleetfrog/protocol/domain/action";

import { inspectWorktree } from "../inspect/inspectWorktree.ts";
import { runGitAction } from "../process/runTool.ts";
import { keepDetachedCommits } from "./detachedCommits.ts";
import { fileCounts, stashTip, trashNewStash } from "./discardedChanges.ts";
import { stashDate } from "./gitActions.ts";
import { failedWith, skipped, succeeded } from "./outcomes.ts";

import type { WorktreeInspection } from "@fleetfrog/protocol/domain/trash";

import type { CheckoutLocation } from "../git/readCheckout.ts";
import type { ActionOutput } from "./actionOutput.ts";

function forceFlags(inspection: WorktreeInspection): ReadonlyArray<string> {
  if (inspection.locked !== null) {
    return ["--force", "--force"];
  }

  return inspection.missing === null ? [] : ["--force"];
}

export const removeWorktree = Effect.fn("removeWorktree")(
  function* (
    location: Pick<CheckoutLocation, "path" | "commonDirectory">,
    options: {
      readonly worktree: string;
      readonly fingerprint: string;
      readonly discardChanges: boolean;
    },
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
    const changedFiles = inspection.changedFiles + inspection.untrackedFiles;
    const verb = options.discardChanges ? "Discarded" : "Stashed";
    let discarded = false;

    if (changedFiles > 0) {
      const before = yield* stashTip(worktree);

      yield* runGitAction({
        cwd: worktree,
        args: [
          "stash",
          "push",
          "--include-untracked",
          "--message",
          `${verb} from FleetFrog before removing the worktree at ${worktree} on ${stashDate(yield* DateTime.now)}`,
        ],
        onOutput: output.write,
      });

      if (options.discardChanges) {
        discarded = yield* trashNewStash(worktree, before, output);
      }
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
        ...fileCounts({ files: changedFiles, discardChanges: options.discardChanges, discarded }),
        savedCommits,
        deletedIgnored: inspection.ignored.total,
      }),
    );
  },
  Effect.catchTag("CommandFailed", failedWith),
);
