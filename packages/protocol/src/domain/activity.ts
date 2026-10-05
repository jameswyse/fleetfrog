import { Schema } from "effect";

import {
  actionTiers,
  ActionKind,
  ActionOutcome,
  ActionRequest,
  OutcomeKind,
  requestTier,
  TargetedRequest,
} from "./action.ts";
import { Count } from "./count.ts";
import { MachineId } from "./machine.ts";
import { PollingSettings } from "./polling.ts";
import { RepositoryKey } from "./repositoryIdentity.ts";
import { IntegrationSettings } from "./t3Code.ts";
import { UserId } from "./user.ts";

import type { Tier } from "./action.ts";

export const BatchId = Schema.String.pipe(Schema.check(Schema.isUUID()), Schema.brand("BatchId"));
export type BatchId = typeof BatchId.Type;

export const RunId = Schema.String.pipe(Schema.check(Schema.isUUID()), Schema.brand("RunId"));
export type RunId = typeof RunId.Type;

export const maximumBatchRuns = 1000;

export const maximumGroupNameLength = 100;

export const GroupName = Schema.String.check(Schema.isMaxLength(maximumGroupNameLength));

export const ActionScope = Schema.TaggedUnion({
  Checkout: { machineId: MachineId, path: Schema.String },
  Repository: { repositoryKey: RepositoryKey },
  Repositories: {
    groupName: GroupName,
    repositoryKeys: Schema.NonEmptyArray(RepositoryKey).check(Schema.isMaxLength(maximumBatchRuns)),
  },
  Machine: { machineId: MachineId },
  All: {},
});
export type ActionScope = typeof ActionScope.Type;

export const CloneTarget = Schema.Struct({
  machineId: MachineId,
  destination: Schema.NonEmptyString,
});
export type CloneTarget = typeof CloneTarget.Type;

export const TargetedRun = Schema.Struct({ machineId: MachineId, request: TargetedRequest });
export type TargetedRun = typeof TargetedRun.Type;

export const RepositoryClone = Schema.Struct({
  repositoryKey: RepositoryKey,
  machineId: MachineId,
  destination: Schema.NonEmptyString,
});
export type RepositoryClone = typeof RepositoryClone.Type;

export const BatchRequest = Schema.TaggedUnion({
  Fetch: { scope: ActionScope },
  Pull: { scope: ActionScope },
  Clone: {
    repositoryKey: RepositoryKey,
    targets: Schema.NonEmptyArray(CloneTarget).check(Schema.isMaxLength(maximumBatchRuns)),
  },
  CloneRepositories: {
    groupName: GroupName,
    clones: Schema.NonEmptyArray(RepositoryClone).check(Schema.isMaxLength(maximumBatchRuns)),
  },
  Targeted: {
    runs: Schema.NonEmptyArray(TargetedRun).check(
      Schema.isMaxLength(maximumBatchRuns),
      Schema.makeFilter(
        ([first, ...rest]) =>
          rest.every(({ request }) => request._tag === first.request._tag) ||
          "Every run in a batch must be the same kind of action.",
      ),
    ),
  },
});
export type BatchRequest = typeof BatchRequest.Type;

export function batchKind(request: BatchRequest): ActionKind {
  if (request._tag === "Targeted") {
    return request.runs[0].request._tag;
  }

  return request._tag === "CloneRepositories" ? "Clone" : request._tag;
}

export function batchTier(request: BatchRequest): Tier {
  if (
    request._tag === "Targeted" &&
    request.runs.some((run) => requestTier(run.request) === "cleanup")
  ) {
    return "cleanup";
  }

  return actionTiers[batchKind(request)];
}

export const BatchScope = Schema.TaggedUnion({
  Checkout: { machineName: Schema.String, repositoryName: Schema.String, path: Schema.String },
  Repository: { repositoryName: Schema.String },
  Group: { groupName: Schema.String, repositories: Count },
  Machine: { machineName: Schema.String },
  All: {},
});
export type BatchScope = typeof BatchScope.Type;

export const RunState = Schema.TaggedUnion({
  Queued: {},
  Running: { startedAt: Schema.DateTimeUtc, progress: Schema.NullOr(Schema.String) },
  Finished: {
    startedAt: Schema.NullOr(Schema.DateTimeUtc),
    finishedAt: Schema.DateTimeUtc,
    outcome: ActionOutcome,
  },
});
export type RunState = typeof RunState.Type;

export const ActionRun = Schema.Struct({
  id: RunId,
  batchId: BatchId,
  machineId: MachineId,
  machineName: Schema.String,
  repositoryKey: RepositoryKey,
  repositoryName: Schema.String,
  path: Schema.String,
  request: ActionRequest,
  state: RunState,
});
export type ActionRun = typeof ActionRun.Type;

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

export const Actor = Schema.NullOr(Schema.Struct({ userId: UserId, name: Schema.String }));
export type Actor = typeof Actor.Type;

export const ActionBatch = Schema.Struct({
  id: BatchId,
  kind: ActionKind,
  scope: BatchScope,
  requestedAt: Schema.DateTimeUtc,
  finishedAt: Schema.NullOr(Schema.DateTimeUtc),
  counts: RunCounts,
  machineNames: Schema.Array(Schema.String),
  requestedBy: Actor,
});
export type ActionBatch = typeof ActionBatch.Type;

export const RunDetail = Schema.Struct({
  run: ActionRun,
  output: Schema.Array(Schema.String),
});
export type RunDetail = typeof RunDetail.Type;

export const BatchDetail = Schema.Struct({
  batch: ActionBatch,
  runs: Schema.Array(RunDetail),
});
export type BatchDetail = typeof BatchDetail.Type;

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
  Event: { at: Schema.DateTimeUtc, event: HubEvent, by: Actor },
});
export type ActivityEntry = typeof ActivityEntry.Type;

const activityFilterLimit = 500;

export const ActivityFilter = Schema.Struct({
  machineIds: Schema.Array(MachineId).check(Schema.isMaxLength(activityFilterLimit)),
  repositoryKeys: Schema.Array(RepositoryKey).check(Schema.isMaxLength(activityFilterLimit)),
  outcomes: Schema.Array(OutcomeKind).check(Schema.isMaxLength(activityFilterLimit)),
});
export type ActivityFilter = typeof ActivityFilter.Type;

export const ActivityPage = Schema.Struct({
  entries: Schema.Array(ActivityEntry),
  hasMore: Schema.Boolean,
});
export type ActivityPage = typeof ActivityPage.Type;

export const RunsSnapshot = Schema.Struct({
  activeBatches: Schema.Array(ActionBatch),
  active: Schema.Array(ActionRun),
  latest: Schema.Array(ActionRun),
});
export type RunsSnapshot = typeof RunsSnapshot.Type;

export const activityRetentionDays = 30;
