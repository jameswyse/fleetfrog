import { clonePath } from "@fleetfrog/protocol/domain/checkout";

import type {
  BranchTip,
  Checkout,
  GitStatus,
  LocalBranch,
  MergedPullRequest,
} from "@fleetfrog/protocol/domain/checkout";
import type { Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

export type BranchStanding =
  | { readonly _tag: "Merged" }
  | { readonly _tag: "MergedPullRequest"; readonly pullRequest: MergedPullRequest }
  | { readonly _tag: "Pushed" }
  | { readonly _tag: "LocalOnly"; readonly commits: number };

export interface TidyCandidate {
  readonly name: string;
  readonly tip: BranchTip;
  readonly standing: BranchStanding;
  readonly isDefault: boolean;
}

export interface KeptBranch {
  readonly name: string;
  readonly reason: string;
}

export interface BranchTidying {
  readonly candidates: ReadonlyArray<TidyCandidate>;
  readonly kept: ReadonlyArray<KeptBranch>;
  readonly ignored: ReadonlyArray<string>;
}

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

export function recentFirst(left: LocalBranch, right: LocalBranch): number {
  return (
    (right.tip?.committedAt.epochMilliseconds ?? 0) - (left.tip?.committedAt.epochMilliseconds ?? 0)
  );
}

export function branchStanding(
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

export function tidyCandidates(options: {
  readonly checkout: Checkout;
  readonly git: GitStatus;
  readonly inOtherWorktrees: ReadonlyMap<string, string>;
  readonly ignoredBranches: ReadonlyArray<string>;
}): BranchTidying {
  const { git } = options;
  const current = git.head._tag === "Detached" ? null : git.head.name;
  const defaultBranch = git.defaultBranch ?? options.checkout.github?.defaultBranch ?? null;
  const merged = options.checkout.github?.mergedPullRequests ?? [];
  const candidates: Array<TidyCandidate> = [];
  const kept: Array<KeptBranch> = [];
  const ignored: Array<string> = [];

  for (const branch of git.branches.items) {
    const { name, tip } = branch;
    const worktree = options.inOtherWorktrees.get(name);

    if (options.ignoredBranches.includes(name)) {
      ignored.push(name);
    } else if (name === current) {
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
        standing: branchStanding({ ...branch, tip }, merged),
        isDefault: name === defaultBranch,
      });
    }
  }

  return { candidates, kept, ignored };
}

export type MergeProof =
  | { readonly _tag: "PullRequest"; readonly pullRequest: MergedPullRequest }
  | { readonly _tag: "DefaultBranch" };

export function mergeProof(checkout: Checkout): MergeProof | null {
  if (checkout.status._tag !== "Read") {
    return null;
  }

  const { git } = checkout.status;
  const { head, lastCommit } = git;
  const defaultBranch = git.defaultBranch ?? checkout.github?.defaultBranch ?? null;

  if (head._tag !== "Branch" || head.name === defaultBranch || lastCommit === null) {
    return null;
  }

  const pullRequest = checkout.github?.mergedPullRequests.find(
    ({ branch, sha }) => branch === head.name && sha === lastCommit.sha,
  );

  if (pullRequest !== undefined) {
    return { _tag: "PullRequest", pullRequest };
  }

  const tip = git.branches.items.find(({ name }) => name === head.name)?.tip ?? null;

  return tip?.merged === true && head.upstream?.gone === true ? { _tag: "DefaultBranch" } : null;
}

export function isPreselected(candidate: TidyCandidate): boolean {
  const { standing } = candidate;

  return (
    (standing._tag === "Merged" || standing._tag === "MergedPullRequest") && !candidate.isDefault
  );
}
