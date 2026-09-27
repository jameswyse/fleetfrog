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
  /** The branch the remote's HEAD points at, which can go but is never preselected. */
  readonly isDefault: boolean;
}

/** A branch that can't be deleted yet, with what to do first. */
export interface KeptBranch {
  readonly name: string;
  readonly reason: string;
}

/** The branches a checkout could tidy away, and those it can't yet. */
export interface BranchTidying {
  readonly candidates: ReadonlyArray<TidyCandidate>;
  readonly kept: ReadonlyArray<KeptBranch>;
}

/**
 * The branches the clone's other worktrees on this machine have checked out, each with that
 * worktree's path: those FleetFrog reads and every one its main checkout lists, including
 * worktrees whose links broke.
 */
export function branchesInOtherWorktrees({
  repository,
  machineId,
  checkout,
}: {
  readonly repository: Repository;
  readonly machineId: Machine["id"];
  readonly checkout: Checkout;
}): ReadonlyMap<string, string> {
  const clone = repository.checkouts.filter(
    (entry) => entry.machineId === machineId && clonePath(entry.checkout) === clonePath(checkout),
  );
  const read = clone
    .filter((entry) => entry.checkout.path !== checkout.path)
    .flatMap(({ checkout: other }): ReadonlyArray<readonly [string, string]> =>
      other.status._tag === "Read" && other.status.git.head._tag === "Branch"
        ? [[other.status.git.head.name, other.path]]
        : [],
    );
  const listed = clone.flatMap(({ checkout: other }): ReadonlyArray<readonly [string, string]> =>
    other.status._tag === "Read"
      ? other.status.git.worktrees
          .filter(({ path }) => path !== checkout.path)
          .flatMap(({ branch, path }) => (branch === null ? [] : [[branch, path] as const]))
      : [],
  );

  return new Map([...listed, ...read]);
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
 * The branches that could be deleted, each with how safe that is, and those that can't be yet,
 * each with what to do first: the checked-out branch, branches checked out in other worktrees and
 * branches from an agent too old to report their tips.
 */
export function tidyCandidates(options: {
  readonly checkout: Checkout;
  readonly git: GitStatus;
  /** Branches checked out in other worktrees, each with that worktree's path. */
  readonly inOtherWorktrees: ReadonlyMap<string, string>;
}): BranchTidying {
  const { git } = options;
  const current = git.head._tag === "Detached" ? null : git.head.name;
  const defaultBranch = git.defaultBranch ?? options.checkout.github?.defaultBranch ?? null;
  const merged = options.checkout.github?.mergedPullRequests ?? [];
  const candidates: Array<TidyCandidate> = [];
  const kept: Array<KeptBranch> = [];

  for (const branch of git.branches.items) {
    const { name, tip } = branch;
    const worktree = options.inOtherWorktrees.get(name);

    if (name === current) {
      kept.push({ name, reason: "Checked out here. Switch to another branch first." });
    } else if (worktree !== undefined) {
      kept.push({
        name,
        reason: `Checked out in the worktree at ${worktree}. Switch it to another branch, or remove it, first.`,
      });
    } else if (tip === null) {
      kept.push({
        name,
        reason: "The machine's agent didn't report its commits. Update FleetFrog on it first.",
      });
    } else {
      candidates.push({
        name,
        tip,
        standing: standingOf({ ...branch, tip }, merged),
        isDefault: name === defaultBranch,
      });
    }
  }

  return { candidates, kept };
}

/** Whether deleting the branch loses nothing that isn't already merged. */
export function isMerged(candidate: TidyCandidate): boolean {
  return candidate.standing._tag === "Merged" || candidate.standing._tag === "MergedPullRequest";
}

/** Whether the dialog chooses the branch to start with: merged, and not the default branch. */
export function isPreselected(candidate: TidyCandidate): boolean {
  return isMerged(candidate) && !candidate.isDefault;
}
