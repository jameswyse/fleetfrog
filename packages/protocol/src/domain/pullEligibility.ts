import { SkipReason } from "./action.ts";

import type { GitStatus } from "./checkout.ts";

/**
 * Why a pull would skip this checkout, or `null` when it can go ahead. A pull only fast-forwards,
 * so no operation such as a merge may be part-way through, and the checkout must be on a branch
 * with an upstream, with nothing to push and no changes to tracked files. Untracked files are
 * allowed because Git refuses to overwrite them itself.
 *
 * The dashboard uses this to predict skips and the agent checks it again before and after fetching.
 */
export function pullBlocker(git: GitStatus): SkipReason | null {
  const { head } = git;

  if (git.operation !== null) {
    return SkipReason.cases.OperationInProgress.make({ operation: git.operation });
  }

  if (head._tag === "Detached") {
    return SkipReason.cases.Detached.make({});
  }

  if (head._tag === "Unborn") {
    return SkipReason.cases.NoCommits.make({});
  }

  if (head.upstream === null) {
    return SkipReason.cases.NoUpstream.make({});
  }

  if (head.upstream.gone) {
    return SkipReason.cases.UpstreamGone.make({});
  }

  if (git.changed.total > 0) {
    return SkipReason.cases.UncommittedChanges.make({ files: git.changed.total });
  }

  if (head.upstream.ahead > 0) {
    return SkipReason.cases.UnpushedCommits.make({ commits: head.upstream.ahead });
  }

  return null;
}
