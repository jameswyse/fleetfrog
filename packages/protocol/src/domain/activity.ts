import { Schema } from "effect";

import {
  ActionKind,
  ActionOutcome,
  ActionRequest,
  OutcomeKind,
  TargetedRequest,
} from "./action.ts";
import { Count } from "./count.ts";
import { MachineId } from "./machine.ts";
import { PollingSettings } from "./polling.ts";
import { RepositoryKey } from "./repositoryIdentity.ts";
import { IntegrationSettings } from "./t3Code.ts";

export const BatchId = Schema.String.pipe(Schema.check(Schema.isUUID()), Schema.brand("BatchId"));
export type BatchId = typeof BatchId.Type;

export const RunId = Schema.String.pipe(Schema.check(Schema.isUUID()), Schema.brand("RunId"));
export type RunId = typeof RunId.Type;

/** Which checkouts a fetch or pull covers. */
export const ActionScope = Schema.TaggedUnion({
  Checkout: { machineId: MachineId, path: Schema.String },
  Repository: { repositoryKey: RepositoryKey },
  Machine: { machineId: MachineId },
  All: {},
});
export type ActionScope = typeof ActionScope.Type;

export const CloneTarget = Schema.Struct({
  machineId: MachineId,
  /** May start with `~`. */
  destination: Schema.NonEmptyString,
});
export type CloneTarget = typeof CloneTarget.Type;

/** One action addressed to one target on one machine. */
export const TargetedRun = Schema.Struct({ machineId: MachineId, request: TargetedRequest });
export type TargetedRun = typeof TargetedRun.Type;

/** What the dashboard asks for. The hub expands it into one run per machine and checkout. */
export const BatchRequest = Schema.TaggedUnion({
  Fetch: { scope: ActionScope },
  Pull: { scope: ActionScope },
  Clone: { repositoryKey: RepositoryKey, targets: Schema.NonEmptyArray(CloneTarget) },
  /** Actions of one kind, each on its own target. */
  Targeted: {
    runs: Schema.NonEmptyArray(TargetedRun).check(
      Schema.makeFilter(
        ([first, ...rest]) =>
          rest.every(({ request }) => request._tag === first.request._tag) ||
          "Every run in a batch must be the same kind of action.",
      ),
    ),
  },
});
export type BatchRequest = typeof BatchRequest.Type;

/**
 * What a batch covered, with the names as they were when it ran, so history still reads correctly
 * after a machine is renamed or removed.
 */
export const BatchScope = Schema.TaggedUnion({
  Checkout: { machineName: Schema.String, repositoryName: Schema.String, path: Schema.String },
  Repository: { repositoryName: Schema.String },
  Machine: { machineName: Schema.String },
  All: {},
});
export type BatchScope = typeof BatchScope.Type;

export const RunState = Schema.TaggedUnion({
  /** Sent to the agent, which is waiting for the repository or a network slot. */
  Queued: {},
  Running: { startedAt: Schema.DateTimeUtc, progress: Schema.NullOr(Schema.String) },
  Finished: {
    startedAt: Schema.NullOr(Schema.DateTimeUtc),
    finishedAt: Schema.DateTimeUtc,
    outcome: ActionOutcome,
  },
});
export type RunState = typeof RunState.Type;

/** One action on one machine. */
export const ActionRun = Schema.Struct({
  id: RunId,
  batchId: BatchId,
  machineId: MachineId,
  machineName: Schema.String,
  repositoryKey: RepositoryKey,
  repositoryName: Schema.String,
  /** The checkout acted on, or the absolute clone destination. */
  path: Schema.String,
  request: ActionRequest,
  state: RunState,
});
export type ActionRun = typeof ActionRun.Type;

/** How many of a batch's runs are in each state. */
export const RunCounts = Schema.Struct({
  Queued: Count,
  Running: Count,
  Succeeded: Count,
  Failed: Count,
  Skipped: Count,
  Cancelled: Count,
  Interrupted: Count,
  MachineOffline: Count,
});
export type RunCounts = typeof RunCounts.Type;
export type RunStatus = keyof RunCounts;

export const ActionBatch = Schema.Struct({
  id: BatchId,
  kind: ActionKind,
  scope: BatchScope,
  requestedAt: Schema.DateTimeUtc,
  /** Null while any run is queued or running. */
  finishedAt: Schema.NullOr(Schema.DateTimeUtc),
  counts: RunCounts,
  /** The machines its runs went to, by the names they had then, in alphabetical order. */
  machineNames: Schema.Array(Schema.String),
});
export type ActionBatch = typeof ActionBatch.Type;

export const RunDetail = Schema.Struct({
  run: ActionRun,
  /** The last lines of Git's output, once the run has finished. */
  output: Schema.Array(Schema.String),
});
export type RunDetail = typeof RunDetail.Type;

export const BatchDetail = Schema.Struct({
  batch: ActionBatch,
  runs: Schema.Array(RunDetail),
});
export type BatchDetail = typeof BatchDetail.Type;

/** Changes made from the dashboard, recorded alongside actions. */
export const HubEvent = Schema.TaggedUnion({
  MachinePaired: { machineId: MachineId, machineName: Schema.String },
  MachineRemoved: { machineId: MachineId, machineName: Schema.String },
  MachineRenamed: { machineId: MachineId, from: Schema.String, to: Schema.String },
  DiscoveryRootsChanged: {
    machineId: MachineId,
    machineName: Schema.String,
    roots: Schema.Array(Schema.String),
  },
  PollingChanged: { polling: PollingSettings },
  IntegrationsChanged: { integrations: IntegrationSettings },
  ArchiveFolderChanged: {
    machineId: MachineId,
    machineName: Schema.String,
    folder: Schema.NullOr(Schema.String),
  },
  ProjectFolderCreated: { machineId: MachineId, machineName: Schema.String, path: Schema.String },
});
export type HubEvent = typeof HubEvent.Type;

export const ActivityEntry = Schema.TaggedUnion({
  Batch: { batch: ActionBatch },
  Event: { at: Schema.DateTimeUtc, event: HubEvent },
});
export type ActivityEntry = typeof ActivityEntry.Type;

const activityFilterLimit = 500;

/**
 * Narrows the activity history. A batch matches when one of its runs matches every non-empty list,
 * and a list matches any of its values. Events match only a machine filter, never a repository or
 * outcome.
 */
export const ActivityFilter = Schema.Struct({
  machineIds: Schema.Array(MachineId).check(Schema.isMaxLength(activityFilterLimit)),
  repositoryKeys: Schema.Array(RepositoryKey).check(Schema.isMaxLength(activityFilterLimit)),
  outcomes: Schema.Array(OutcomeKind).check(Schema.isMaxLength(activityFilterLimit)),
});
export type ActivityFilter = typeof ActivityFilter.Type;

export const ActivityPage = Schema.Struct({
  /** Newest first. */
  entries: Schema.Array(ActivityEntry),
  hasMore: Schema.Boolean,
});
export type ActivityPage = typeof ActivityPage.Type;

export const RunsSnapshot = Schema.Struct({
  /** Batches with runs still queued or running, oldest first. */
  activeBatches: Schema.Array(ActionBatch),
  /** Queued and running runs, oldest first. */
  active: Schema.Array(ActionRun),
  /** The most recent finished run for each path on each machine. */
  latest: Schema.Array(ActionRun),
});
export type RunsSnapshot = typeof RunsSnapshot.Type;

export const activityRetentionDays = 30;
