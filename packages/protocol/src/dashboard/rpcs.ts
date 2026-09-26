import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import {
  ActivityFilter,
  ActivityPage,
  BatchDetail,
  BatchId,
  BatchRequest,
  RunId,
  RunsSnapshot,
} from "../domain/activity.ts";
import { Fleet } from "../domain/fleet.ts";
import { MachineId, MachineKind } from "../domain/machine.ts";
import { PollingSettings } from "../domain/polling.ts";
import { RepositoryKey } from "../domain/repositoryIdentity.ts";

export class MachineNotFound extends Schema.TaggedError<MachineNotFound>()("MachineNotFound", {
  machineId: MachineId,
}) {}

export class RepositoryNotFound extends Schema.TaggedError<RepositoryNotFound>()(
  "RepositoryNotFound",
  { repositoryKey: RepositoryKey },
) {}

/** The scope matched no checkouts, so there was nothing to run. */
export class NothingToRun extends Schema.TaggedError<NothingToRun>()("NothingToRun", {}) {}

/** No checkout of the repository has an HTTPS or SSH origin to clone from. */
export class NoCloneSource extends Schema.TaggedError<NoCloneSource>()("NoCloneSource", {}) {}

export class BatchNotFound extends Schema.TaggedError<BatchNotFound>()("BatchNotFound", {
  batchId: BatchId,
}) {}

export const CancelTarget = Schema.TaggedUnion({
  Batch: { batchId: BatchId },
  Run: { runId: RunId },
});
export type CancelTarget = typeof CancelTarget.Type;

/** How many activity entries a page starts with, and how many more each "Show older" adds. */
export const activityPageSize = 50;
/** The most activity entries one stream sends. */
export const activityLimit = 1000;

export const RefreshTarget = Schema.TaggedUnion({
  All: {},
  Machine: { machineId: MachineId },
});
export type RefreshTarget = typeof RefreshTarget.Type;

/** Where agents should connect, as far as the hub knows. */
export const AgentEndpoint = Schema.TaggedUnion({
  /** An explicitly configured public URL, e.g. behind a reverse proxy. */
  Url: { url: Schema.String },
  /** The same host the dashboard was loaded from, on the agent port. */
  DashboardHost: { scheme: Schema.Literals(["wss", "ws"]), port: Schema.Int },
});
export type AgentEndpoint = typeof AgentEndpoint.Type;

export const PairingOffer = Schema.Struct({
  code: Schema.String,
  certificateFingerprint: Schema.NullOr(Schema.String),
  endpoint: AgentEndpoint,
  expiresAt: Schema.DateTimeUtc,
});
export type PairingOffer = typeof PairingOffer.Type;

/** Served over WebSocket on the dashboard port. */
export class DashboardRpcs extends RpcGroup.make(
  /** Streams the whole fleet on subscribe and after every change. Agents poll faster while any subscription is open. */
  Rpc.make("WatchFleet", { success: Fleet, stream: true }),
  Rpc.make("Refresh", { payload: { target: RefreshTarget }, error: MachineNotFound }),
  Rpc.make("RenameMachine", {
    payload: { machineId: MachineId, customName: Schema.NullOr(Schema.NonEmptyString) },
    error: MachineNotFound,
  }),
  /** A null kind follows what the agent detects. */
  Rpc.make("SetMachineKind", {
    payload: { machineId: MachineId, kind: Schema.NullOr(MachineKind) },
    error: MachineNotFound,
  }),
  Rpc.make("SetDiscoveryRoots", {
    payload: { machineId: MachineId, roots: Schema.Array(Schema.NonEmptyString) },
    error: MachineNotFound,
  }),
  Rpc.make("RemoveMachine", { payload: { machineId: MachineId }, error: MachineNotFound }),
  Rpc.make("UpdatePolling", { payload: { polling: PollingSettings } }),
  Rpc.make("CreatePairingOffer", { success: PairingOffer }),
  Rpc.make("StartBatch", {
    payload: { request: BatchRequest },
    success: Schema.Struct({ batchId: BatchId }),
    error: Schema.Union([MachineNotFound, RepositoryNotFound, NothingToRun, NoCloneSource]),
  }),
  /** Cancelling a run that has already finished does nothing. */
  Rpc.make("Cancel", { payload: { target: CancelTarget } }),
  /** Streams active runs and each checkout's latest result on subscribe and after every change. */
  Rpc.make("WatchRuns", { success: RunsSnapshot, stream: true }),
  Rpc.make("WatchActivity", {
    payload: {
      filter: ActivityFilter,
      limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: activityLimit })),
    },
    success: ActivityPage,
    stream: true,
  }),
  Rpc.make("WatchBatch", {
    payload: { batchId: BatchId },
    success: BatchDetail,
    error: BatchNotFound,
    stream: true,
  }),
) {}
