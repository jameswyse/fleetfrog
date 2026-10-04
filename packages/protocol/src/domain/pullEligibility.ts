import { SkipReason } from "./action.ts";

import type { GitStatus } from "./checkout.ts";

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
