import { summariseCheckout } from "./checkoutSummary.ts";

import type { MachineCheckout, Repository } from "@fleetfrog/protocol/domain/fleet";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";

import type { CheckoutSummary } from "./checkoutSummary.ts";

/** Something a person has to sort out by hand, which the cell shows in red. */
export type CellProblem = "Unreadable" | "Conflicts" | "UpstreamGone";

/** One repository on one machine, boiled down to what its cell in the grid shows. */
export interface CellSummary {
  /** Each clone's main worktree before any linked worktrees, in path order within each. */
  readonly entries: ReadonlyArray<MachineCheckout>;
  /** The checkout the cell speaks for: the first clone's main worktree. */
  readonly primary: MachineCheckout;
  /** The primary checkout's branch, or null when it couldn't be read. */
  readonly branch: string | null;
  /** The primary checkout is on a branch other than GitHub's default branch. */
  readonly offDefault: boolean;
  /** Changed and untracked files across every checkout. */
  readonly changes: number;
  /** Stashes across every clone. Worktrees of one clone share its stashes. */
  readonly stashes: number;
  /** The primary checkout's commits to push and to pull. */
  readonly ahead: number;
  readonly behind: number;
  /** GitHub's default branch has commits the primary checkout hasn't fetched. */
  readonly remoteMoved: boolean;
  /** Local branches in the primary checkout's clone. */
  readonly branches: number;
  readonly worktrees: number;
  readonly clones: number;
  /** Open pull requests from branches checked out here. */
  readonly pullRequests: number;
  readonly problem: CellProblem | null;
}

type ReadSummary = Extract<CheckoutSummary, { _tag: "Read" }>;

function isMain(entry: MachineCheckout): boolean {
  return entry.checkout.worktree._tag === "Main";
}

function problemOf(summaries: ReadonlyArray<CheckoutSummary>): CellProblem | null {
  if (summaries.some(({ _tag }) => _tag === "Unreadable")) {
    return "Unreadable";
  }

  const read = summaries.filter((summary): summary is ReadSummary => summary._tag === "Read");

  if (read.some(({ conflicts }) => conflicts)) {
    return "Conflicts";
  }

  return read.some(({ upstream }) => upstream === "gone") ? "UpstreamGone" : null;
}

/** The cell for a repository's checkouts on one machine, or null when it has none there. */
export function summariseCell(entries: ReadonlyArray<MachineCheckout>): CellSummary | null {
  const sorted = entries.toSorted(
    (left, right) =>
      Number(!isMain(left)) - Number(!isMain(right)) ||
      left.checkout.path.localeCompare(right.checkout.path),
  );

  const [primary] = sorted;

  if (primary === undefined) {
    return null;
  }

  const summaries = sorted.map(({ checkout }) => summariseCheckout(checkout));
  const read = summaries.filter((summary): summary is ReadSummary => summary._tag === "Read");
  const [first] = summaries;
  const main = first?._tag === "Read" ? first : null;
  const defaultBranch = primary.checkout.github?.defaultBranch ?? null;
  const git = primary.checkout.status._tag === "Read" ? primary.checkout.status.git : null;

  return {
    entries: sorted,
    primary,
    branch: main?.branch ?? null,
    offDefault: main !== null && defaultBranch !== null && main.branch !== defaultBranch,
    changes: read.reduce((sum, { changed, untracked }) => sum + changed + untracked, 0),
    stashes: sorted.reduce(
      (sum, entry, index) =>
        isMain(entry) && summaries[index]?._tag === "Read" ? sum + summaries[index].stashes : sum,
      0,
    ),
    ahead: main?.ahead ?? 0,
    behind: main?.behind ?? 0,
    remoteMoved: main?.remoteMoved ?? false,
    branches: git?.branches.total ?? 0,
    worktrees: sorted.filter((entry) => !isMain(entry)).length,
    clones: sorted.filter(isMain).length,
    pullRequests: new Set(
      read.flatMap(({ pullRequest }) => (pullRequest === null ? [] : [pullRequest.number])),
    ).size,
    problem: problemOf(summaries),
  };
}

/** A repository's cell on one machine, or null when the machine has none of its checkouts. */
export function cellFor(repository: Repository, machineId: MachineId): CellSummary | null {
  return summariseCell(repository.checkouts.filter((entry) => entry.machineId === machineId));
}

/**
 * Every open pull request any machine knows of. Each checkout reports only those from its own local
 * branches, so no single reading has them all.
 */
export function openPullRequests(repository: Repository) {
  const pulls = new Map(
    repository.checkouts.flatMap(({ checkout }) =>
      (checkout.github?.pullRequests ?? []).map((pull) => [pull.number, pull] as const),
    ),
  );

  return [...pulls.values()].toSorted((left, right) => right.number - left.number);
}

/** The newest GitHub reading any machine has for the repository. */
export function latestGithub(repository: Repository) {
  return repository.checkouts
    .flatMap(({ checkout }) => (checkout.github === null ? [] : [checkout.github]))
    .toSorted((left, right) => right.checkedAt.epochMilliseconds - left.checkedAt.epochMilliseconds)
    .at(0);
}
