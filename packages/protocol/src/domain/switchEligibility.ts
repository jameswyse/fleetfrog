import { SkipReason } from "./action.ts";

import type { GitStatus } from "./checkout.ts";

/**
 * Why switching this checkout to `branch` would be skipped, or `null` when it can go ahead. The
 * working tree must have no changes to tracked files, so nothing is carried to the other branch,
 * and HEAD must be on a branch, so no commit is left behind. Untracked files stay where they are,
 * and Git refuses a switch that would overwrite one.
 *
 * The dashboard uses this to predict skips and the agent checks it again before switching. Only
 * the agent can tell whether another worktree has the branch checked out.
 */
export function switchBlocker(git: GitStatus, branch: string): SkipReason | null {
  const { head } = git;

  if (git.operation !== null) {
    return SkipReason.cases.OperationInProgress.make({ operation: git.operation });
  }

  if (head._tag === "Detached") {
    return SkipReason.cases.Detached.make({});
  }

  if (head.name === branch) {
    return SkipReason.cases.AlreadyOnBranch.make({});
  }

  const listed = git.branches.items.some(({ name }) => name === branch);

  // A branch past the end of a truncated list may still exist, so only a full list can rule it out.
  if (!listed && git.branches.items.length === git.branches.total) {
    return SkipReason.cases.NoSuchBranch.make({});
  }

  if (git.changed.total > 0) {
    return SkipReason.cases.UncommittedChanges.make({ files: git.changed.total });
  }

  return null;
}
