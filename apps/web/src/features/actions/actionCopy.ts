import {
  ActionOutcome,
  ActionResult,
  OutcomeKind,
  SkipReason,
} from "@fleetfrog/protocol/domain/action";
import { BatchScope, HubEvent } from "@fleetfrog/protocol/domain/activity";

import type {
  ActionBatch,
  ActionRun,
  RunCounts,
  RunStatus,
} from "@fleetfrog/protocol/domain/activity";

function count(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function describeBatch({ kind, scope }: Pick<ActionBatch, "kind" | "scope">): string {
  const things = kind === "Pull" ? "checkout" : "repository";

  return BatchScope.match(scope, {
    Checkout: ({ repositoryName, machineName }) => `${kind} ${repositoryName} on ${machineName}`,
    Repository: ({ repositoryName }) =>
      kind === "Clone" ? `Clone ${repositoryName}` : `${kind} ${repositoryName} on every machine`,
    Machine: ({ machineName }) => `${kind} every ${things} on ${machineName}`,
    All: () => `${kind} every ${things}`,
  });
}

export function describeSkip(reason: SkipReason): string {
  return SkipReason.match(reason, {
    Detached: () => "Not on a branch",
    NoCommits: () => "The branch has no commits yet",
    NoUpstream: () => "The branch has no upstream",
    UpstreamGone: () => "The upstream branch was deleted",
    UncommittedChanges: ({ files }) => count(files, "changed file"),
    UnpushedCommits: ({ commits }) => `${count(commits, "commit")} to push`,
    NotAllowed: () => "Git actions are turned off on this machine",
    AgentOutdated: () => "The agent needs updating",
  });
}

function describeResult(result: ActionResult): string {
  return ActionResult.match(result, {
    Fetched: () => "Fetched",
    FastForwarded: ({ commits }) => `Pulled ${count(commits, "commit")}`,
    UpToDate: () => "Already up to date",
    Cloned: () => "Cloned",
  });
}

/** A finished run's result in a few words, with any detail to show after it. */
export interface OutcomeText {
  readonly summary: string;
  readonly detail: string | null;
}

export function describeOutcome(outcome: ActionOutcome): OutcomeText {
  return ActionOutcome.match(outcome, {
    Succeeded: ({ result }): OutcomeText => ({ summary: describeResult(result), detail: null }),
    Failed: ({ message }): OutcomeText => ({ summary: "Failed", detail: message }),
    Skipped: ({ reason }): OutcomeText => ({ summary: "Skipped", detail: describeSkip(reason) }),
    Cancelled: (): OutcomeText => ({ summary: "Cancelled", detail: null }),
    Interrupted: (): OutcomeText => ({
      summary: "Interrupted",
      detail: "The agent disconnected before it finished",
    }),
    MachineOffline: (): OutcomeText => ({ summary: "Machine offline", detail: null }),
  });
}

export const outcomeLabels = {
  Succeeded: "Succeeded",
  Failed: "Failed",
  Skipped: "Skipped",
  Cancelled: "Cancelled",
  Interrupted: "Interrupted",
  MachineOffline: "Machine offline",
} satisfies Record<OutcomeKind, string>;

export const outcomeKinds = OutcomeKind.literals;

/** Run states in the order a batch's summary lists them. */
const summaryOrder: ReadonlyArray<RunStatus> = ["Running", "Queued", ...OutcomeKind.literals];

const countPhrases = {
  Running: (value) => `${value} running`,
  Queued: (value) => `${value} waiting`,
  Succeeded: (value) => `${value} succeeded`,
  Failed: (value) => `${value} failed`,
  Skipped: (value) => `${value} skipped`,
  Cancelled: (value) => `${value} cancelled`,
  Interrupted: (value) => `${value} interrupted`,
  MachineOffline: (value) => `${value} offline`,
} satisfies Record<RunStatus, (value: number) => string>;

/** Each state some of a batch's runs are in, with its phrase, such as "3 succeeded". */
export function countParts(
  counts: RunCounts,
): ReadonlyArray<{ readonly status: RunStatus; readonly text: string }> {
  return summaryOrder
    .filter((status) => counts[status] > 0)
    .map((status) => ({ status, text: countPhrases[status](counts[status]) }));
}

/** The batch's runs by state, such as "3 succeeded, 1 skipped". */
export function describeCounts(counts: RunCounts): string {
  return countParts(counts)
    .map(({ text }) => text)
    .join(", ");
}

/** What a queued or running run is doing, in a word or two: "Cloning", or "Waiting to clone". */
export function describeActiveRunBriefly(run: ActionRun): string {
  return run.state._tag === "Running"
    ? { Fetch: "Fetching", Pull: "Pulling", Clone: "Cloning" }[run.request._tag]
    : `Waiting to ${run.request._tag.toLowerCase()}`;
}

/** What a queued or running run is doing now, with Git's latest progress line. */
export function describeActiveRun(run: ActionRun): string {
  const brief = describeActiveRunBriefly(run);

  if (run.state._tag !== "Running") {
    return brief;
  }

  return run.state.progress === null ? `${brief}…` : `${brief}: ${run.state.progress}`;
}

export function describeEvent(event: HubEvent): string {
  return HubEvent.match(event, {
    MachinePaired: ({ machineName }) => `Paired ${machineName}`,
    MachineRemoved: ({ machineName }) => `Removed ${machineName}`,
    MachineRenamed: ({ from, to }) => `Renamed ${from} to ${to}`,
    DiscoveryRootsChanged: ({ machineName, roots }) =>
      roots.length === 0
        ? `Removed every project folder on ${machineName}`
        : `Set the project folders on ${machineName} to ${roots.join(", ")}`,
    PollingChanged: () => "Changed the polling intervals",
  });
}
