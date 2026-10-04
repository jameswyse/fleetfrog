import { Context, Effect, Schema } from "effect";
import { Rpc, RpcGroup, RpcMiddleware } from "effect/rpc";

import {
  ActionRequest,
  ActionUpdate,
  AdvertisedCapabilities,
  AgentCapabilities,
} from "../domain/action.ts";
import { RunId } from "../domain/activity.ts";
import { Checkout } from "../domain/checkout.ts";
import { FolderOutcome, FolderStatus } from "../domain/fleet.ts";
import { MachineInfo, SystemUsage } from "../domain/machine.ts";
import { ReportedList, ReportedText } from "../domain/reported.ts";
import { T3CodeStatus } from "../domain/t3Code.ts";
import { InspectionResult, TrashedCheckout } from "../domain/trash.ts";

import type { MachineId } from "../domain/machine.ts";

export class CurrentMachine extends Context.Service<CurrentMachine, { readonly id: MachineId }>()(
  "fleetfrog/CurrentMachine",
) {}

export class Unauthorised extends Schema.TaggedError<Unauthorised>()("Unauthorised", {}) {}

export class AgentAuthentication extends RpcMiddleware.Service<
  AgentAuthentication,
  { provides: CurrentMachine }
>()("fleetfrog/AgentAuthentication", { error: Unauthorised }) {}

export const AgentSchedule = Schema.Struct({
  statusSeconds: Schema.Int,
  discoverySeconds: Schema.Int,
  githubSeconds: Schema.Int,
});
export type AgentSchedule = typeof AgentSchedule.Type;

export const T3CodeAgentSettings = Schema.Struct({
  discoverProjects: Schema.Boolean,
  projectIcons: Schema.Boolean,
});
export type T3CodeAgentSettings = typeof T3CodeAgentSettings.Type;

export const ProjectIconFile = Schema.Struct({
  id: ReportedText,
  mediaType: ReportedText,
  base64: Schema.String,
});
export type ProjectIconFile = typeof ProjectIconFile.Type;

export const HubCommand = Schema.TaggedUnion({
  Configure: {
    discoveryRoots: Schema.Array(Schema.String),
    schedule: AgentSchedule,
    archiveFolder: Schema.NullOr(Schema.String).pipe(
      Schema.withDecodingDefaultTypeKey(Effect.succeed(null)),
    ),
    t3Code: Schema.NullOr(T3CodeAgentSettings).pipe(
      Schema.withDecodingDefaultTypeKey(Effect.succeed(null)),
    ),
  },
  Refresh: {},
  RunAction: { runId: RunId, request: ActionRequest },
  CancelAction: { runId: RunId },
  CreateFolder: { requestId: Schema.String, path: Schema.String },
  Inspect: {
    requestId: Schema.String,
    path: Schema.String,
    worktree: Schema.NullOr(Schema.String).pipe(
      Schema.withDecodingDefaultTypeKey(Effect.succeed(null)),
    ),
  },
  Update: { version: Schema.String },
});
export type HubCommand = typeof HubCommand.Type;

export const ReceivedCommand = Schema.Union([
  HubCommand,
  Schema.Struct({ _tag: Schema.String, runId: Schema.optionalKey(RunId) }),
]);

export const ReportedRoot = Schema.Struct({ path: ReportedText, status: FolderStatus });
export type ReportedRoot = typeof ReportedRoot.Type;

export const ScanReport = Schema.TaggedUnion({
  Discovery: {
    checkouts: ReportedList(Checkout),
    roots: ReportedList(ReportedRoot).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
    completedAt: Schema.DateTimeUtc,
  },
  Trash: { items: ReportedList(TrashedCheckout) },
  T3Code: { status: T3CodeStatus },
  ProjectIcons: { icons: ReportedList(ProjectIconFile) },
  Status: {
    changed: ReportedList(Checkout),
    removedPaths: ReportedList(ReportedText),
    completedAt: Schema.DateTimeUtc,
  },
});
export type ScanReport = typeof ScanReport.Type;

export const ReceivedReport = Schema.Union([ScanReport, Schema.Struct({ _tag: Schema.String })]);

export const ReceivedUpdate = Schema.Union([
  ActionUpdate,
  Schema.Struct({ _tag: Schema.Literal("Finished"), output: ReportedList(ReportedText) }),
  Schema.Struct({ _tag: Schema.String }),
]);

export class AgentRpcs extends RpcGroup.make(
  Rpc.make("Connect", {
    payload: { info: MachineInfo, capabilities: AdvertisedCapabilities },
    success: ReceivedCommand,
    stream: true,
  }),
  Rpc.make("Report", { payload: { report: ReceivedReport } }),
  Rpc.make("Advertise", { payload: { capabilities: AgentCapabilities } }),
  Rpc.make("ReportAction", { payload: { runId: RunId, update: ReceivedUpdate } }),
  Rpc.make("ReportFolder", { payload: { requestId: Schema.String, outcome: FolderOutcome } }),
  Rpc.make("ReportUsage", { payload: { usage: SystemUsage } }),
  Rpc.make("ReportInspection", {
    payload: { requestId: Schema.String, result: InspectionResult },
  }),
  Rpc.make("Heartbeat"),
  Rpc.make("TargetVersion", { success: Schema.Struct({ version: Schema.String }) }),
  Rpc.make("ReportUpdateFailure", {
    payload: { version: ReportedText, message: ReportedText },
  }),
).middleware(AgentAuthentication) {}

export const heartbeatSeconds = 15;
export const heartbeatTimeoutSeconds = 3 * heartbeatSeconds;
