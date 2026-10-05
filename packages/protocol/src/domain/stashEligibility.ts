import { SkipReason } from "./action.ts";

import type { GitStatus } from "./checkout.ts";

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

export function discardBlocker(git: GitStatus): SkipReason | null {
  const blocker = stashBlocker(git);

  return blocker?._tag === "NothingToStash" ? SkipReason.cases.NoChanges.make({}) : blocker;
}
