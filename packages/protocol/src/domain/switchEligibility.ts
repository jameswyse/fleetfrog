import { SkipReason } from "./action.ts";

import type { GitStatus } from "./checkout.ts";

/**
 * Why switching this checkout to `branch` can't happen, or `null` when it can go ahead. Only what
 * the developer has to sort out first counts: an operation such as a rebase part-way through, or a
 * branch that isn't there. Changes to tracked files can be stashed first, and commits only a
 * detached HEAD holds are kept in the trash, so neither stops a switch. Untracked files stay where
 * they are, and Git refuses a switch that would overwrite one.
 *
 * The dashboard uses this to predict skips and the agent checks it again before switching. Only
 * the agent can tell whether another worktree has the branch checked out.
 */
export function switchBlocker(git: GitStatus, branch: string): SkipReason | null {
  const { head } = git;

  if (git.operation !== null) {
    return SkipReason.cases.OperationInProgress.make({ operation: git.operation });
  }

  if (head._tag !== "Detached" && head.name === branch) {
    return SkipReason.cases.AlreadyOnBranch.make({});
  }

  const listed = git.branches.items.some(({ name }) => name === branch);

  // A branch past the end of a truncated list may still exist, so only a full list can rule it out.
  return !listed && git.branches.items.length === git.branches.total
    ? SkipReason.cases.NoSuchBranch.make({})
    : null;
}
