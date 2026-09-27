import { SkipReason } from "./action.ts";

import type { GitStatus } from "./checkout.ts";

/**
 * Why stashing this checkout would be skipped, or `null` when it can go ahead. Stashing needs a
 * commit to stash against and something to stash, and waits while an operation such as a merge is
 * part-way through.
 */
export function stashBlocker(git: GitStatus): SkipReason | null {
  if (git.operation !== null) {
    return SkipReason.cases.OperationInProgress.make({ operation: git.operation });
  }

  if (git.head._tag === "Unborn") {
    return SkipReason.cases.NoCommits.make({});
  }

  return git.changed.total + git.untracked.total === 0
    ? SkipReason.cases.NothingToStash.make({})
    : null;
}
