import { clonePath } from "@fleetfrog/protocol/domain/checkout";

import type {
  BranchTip,
  Checkout,
  GitStatus,
  LocalBranch,
  MergedPullRequest,
} from "@fleetfrog/protocol/domain/checkout";
import type { Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

/** How safe deleting a branch is, from nothing lost to commits found nowhere else. */
export type BranchStanding =
  /** Its commits are in the default branch. */
  | { readonly _tag: "Merged" }
  /** A pull request from it was merged, at exactly its tip, such as by squashing. */
  | { readonly _tag: "MergedPullRequest"; readonly pullRequest: MergedPullRequest }
  /** Its commits are on a remote but not in the default branch. */
  | { readonly _tag: "Pushed" }
  /** Some of its commits exist only on this machine. */
  | { readonly _tag: "LocalOnly"; readonly commits: number };

export interface TidyCandidate {
  readonly name: string;
  readonly tip: BranchTip;
  readonly standing: BranchStanding;
}

/**
 * The branches the clone's other worktrees on this machine have checked out: those FleetFrog reads
 * and every one its main checkout lists, including worktrees whose links broke.
 */
export function branchesInOtherWorktrees({
  repository,
  machineId,
  checkout,
}: {
  readonly repository: Repository;
  readonly machineId: Machine["id"];
  readonly checkout: Checkout;
}): ReadonlySet<string> {
  const clone = repository.checkouts.filter(
    (entry) => entry.machineId === machineId && clonePath(entry.checkout) === clonePath(checkout),
  );
  const read = clone
    .filter((entry) => entry.checkout.path !== checkout.path)
    .flatMap(({ checkout: other }) =>
      other.status._tag === "Read" && other.status.git.head._tag === "Branch"
        ? [other.status.git.head.name]
        : [],
    );
  const listed = clone.flatMap(({ checkout: other }) =>
    other.status._tag === "Read"
      ? other.status.git.worktrees
          .filter(({ path }) => path !== checkout.path)
          .flatMap(({ branch }) => (branch === null ? [] : [branch]))
      : [],
  );

  return new Set([...read, ...listed]);
}

function standingOf(
  branch: LocalBranch & { readonly tip: BranchTip },
  merged: ReadonlyArray<MergedPullRequest>,
): BranchStanding {
  if (branch.tip.merged) {
    return { _tag: "Merged" };
  }

  const pullRequest = merged.find(
    ({ branch: name, sha }) => name === branch.name && sha === branch.tip.sha,
  );

  if (pullRequest !== undefined) {
    return { _tag: "MergedPullRequest", pullRequest };
  }

  return branch.tip.pushed
    ? { _tag: "Pushed" }
    : { _tag: "LocalOnly", commits: branch.tip.localCommits };
}

/**
 * The branches that could be deleted, each with how safe that is. The checked-out branch, the
 * default branch and branches checked out in other worktrees are left out, as are branches from an
 * agent too old to report their tips.
 */
export function tidyCandidates(options: {
  readonly checkout: Checkout;
  readonly git: GitStatus;
  readonly inOtherWorktrees: ReadonlySet<string>;
}): ReadonlyArray<TidyCandidate> {
  const { git } = options;
  const current = git.head._tag === "Detached" ? null : git.head.name;
  const defaultBranch = git.defaultBranch ?? options.checkout.github?.defaultBranch ?? null;
  const merged = options.checkout.github?.mergedPullRequests ?? [];

  return git.branches.items.flatMap((branch) => {
    const { tip } = branch;

    if (
      tip === null ||
      branch.name === current ||
      branch.name === defaultBranch ||
      options.inOtherWorktrees.has(branch.name)
    ) {
      return [];
    }

    return [{ name: branch.name, tip, standing: standingOf({ ...branch, tip }, merged) }];
  });
}

/** Whether deleting the branch loses nothing that isn't already merged, so it can be preselected. */
export function isMerged(candidate: TidyCandidate): boolean {
  return candidate.standing._tag === "Merged" || candidate.standing._tag === "MergedPullRequest";
}
