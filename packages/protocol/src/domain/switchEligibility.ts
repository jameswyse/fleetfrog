import { SkipReason } from "./action.ts";

import type { GitStatus } from "./checkout.ts";

export function switchBlocker(git: GitStatus, branch: string): SkipReason | null {
  const { head } = git;

  if (git.operation !== null) {
    return SkipReason.cases.OperationInProgress.make({ operation: git.operation });
  }

  if (head._tag !== "Detached" && head.name === branch) {
    return SkipReason.cases.AlreadyOnBranch.make({});
  }

  const listed = git.branches.items.some(({ name }) => name === branch);

  return !listed && git.branches.items.length === git.branches.total
    ? SkipReason.cases.NoSuchBranch.make({})
    : null;
}
