import { summariseCheckout } from "./checkoutSummary.ts";

import type { MachineCheckout, Repository } from "@fleetfrog/protocol/domain/fleet";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";

import type { CheckoutSummary } from "./checkoutSummary.ts";

export type CellProblem = "Unreadable" | "Conflicts" | "UpstreamGone";

export interface CellSummary {
  readonly entries: ReadonlyArray<MachineCheckout>;
  readonly primary: MachineCheckout;
  readonly branch: string | null;
  readonly offDefault: boolean;
  readonly changes: number;
  readonly stashes: number;
  readonly ahead: number;
  readonly behind: number;
  readonly remoteMoved: boolean;
  readonly branches: number;
  readonly worktrees: number;
  readonly clones: number;
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

export function cellFor(repository: Repository, machineId: MachineId): CellSummary | null {
  return summariseCell(repository.checkouts.filter((entry) => entry.machineId === machineId));
}

export function openPullRequests(repository: Repository) {
  const pulls = new Map(
    repository.checkouts.flatMap(({ checkout }) =>
      (checkout.github?.pullRequests ?? []).map((pull) => [pull.number, pull] as const),
    ),
  );

  return [...pulls.values()].toSorted((left, right) => right.number - left.number);
}

export function latestGithub(repository: Repository) {
  return repository.checkouts
    .flatMap(({ checkout }) => (checkout.github === null ? [] : [checkout.github]))
    .toSorted((left, right) => right.checkedAt.epochMilliseconds - left.checkedAt.epochMilliseconds)
    .at(0);
}
