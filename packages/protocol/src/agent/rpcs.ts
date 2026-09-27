import { Context, Effect, Schema } from "effect";
import { Rpc, RpcGroup, RpcMiddleware } from "effect/unstable/rpc";

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
import { InspectionResult, TrashedCheckout } from "../domain/trash.ts";

import type { MachineId } from "../domain/machine.ts";

/** The machine whose token authenticated the current agent connection. */
export class CurrentMachine extends Context.Service<CurrentMachine, { readonly id: MachineId }>()(
  "fleetfrog/CurrentMachine",
) {}

export class Unauthorised extends Schema.TaggedError<Unauthorised>()("Unauthorised", {}) {}

/** Reads the bearer token sent with the WebSocket upgrade and resolves it to a paired machine. */
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

/** Instructions the hub streams down to a connected agent. */
export const HubCommand = Schema.TaggedUnion({
  /** Sent on connect and whenever the roots, schedule or Archive folder change. */
  Configure: {
    discoveryRoots: Schema.Array(Schema.String),
    schedule: AgentSchedule,
    /** Null when none is set, and from hubs that predate archiving. */
    archiveFolder: Schema.NullOr(Schema.String).pipe(
      Schema.withDecodingDefaultTypeKey(Effect.succeed(null)),
    ),
  },
  /** Rediscover and rescan now. */
  Refresh: {},
  /** Sent only for actions the agent advertised. The agent checks its own policy again. */
  RunAction: { runId: RunId, request: ActionRequest },
  CancelAction: { runId: RunId },
  /**
   * Creates one of the agent's project folders or its Archive folder, answered by `ReportFolder`
   * with the same request id. Sent only to agents that advertise `createsFolders`. The agent checks
   * the path itself.
   */
  CreateFolder: { requestId: Schema.String, path: Schema.String },
  /**
   * Inspects a checkout before it is trashed or deleted, or with `worktree`, that linked worktree
   * of it before it is removed. Answered by `ReportInspection` with the same request id. Sent only
   * to agents that advertise the `Trash` action. One too old to know `worktree` inspects the
   * checkout instead, which the hub can tell from the kind of result.
   */
  Inspect: {
    requestId: Schema.String,
    path: Schema.String,
    worktree: Schema.NullOr(Schema.String).pipe(
      Schema.withDecodingDefaultTypeKey(Effect.succeed(null)),
    ),
  },
});
export type HubCommand = typeof HubCommand.Type;

/**
 * A command as the agent receives it. A newer hub may send a command this agent can't read, which
 * it skips instead of ending the connection, answering one that carries a run id as failed.
 */
export const ReceivedCommand = Schema.Union([
  HubCommand,
  Schema.Struct({ _tag: Schema.String, runId: Schema.optionalKey(RunId) }),
]);

export const ReportedRoot = Schema.Struct({ path: Schema.String, status: FolderStatus });
export type ReportedRoot = typeof ReportedRoot.Type;

export const ScanReport = Schema.TaggedUnion({
  /** A completed discovery walk. Replaces every checkout the hub holds for the machine. */
  Discovery: {
    checkouts: Schema.Array(Checkout),
    /**
     * What the walk found at each discovery folder and at the Archive folder. Absent from agents
     * that predate it.
     */
    roots: Schema.Array(ReportedRoot).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
    completedAt: Schema.DateTimeUtc,
  },
  /** Everything in the machine's trash. Replaces what the hub holds. */
  Trash: { items: Schema.Array(TrashedCheckout) },
  /** A status pass. Carries only checkouts that changed or disappeared since the last report. */
  Status: {
    changed: Schema.Array(Checkout),
    removedPaths: Schema.Array(Schema.String),
    completedAt: Schema.DateTimeUtc,
  },
});
export type ScanReport = typeof ScanReport.Type;

/**
 * A report as the hub receives it. A newer agent may send a kind of report this hub doesn't know,
 * which it ignores instead of refusing the report.
 */
export const ReceivedReport = Schema.Union([ScanReport, Schema.Struct({ _tag: Schema.String })]);

/**
 * An action update as the hub receives it. A newer agent may finish a run with an outcome this hub
 * can't read, which still ends the run, or send a kind of update it doesn't know, which it ignores.
 */
export const ReceivedUpdate = Schema.Union([
  ActionUpdate,
  Schema.Struct({ _tag: Schema.Literal("Finished"), output: Schema.Array(Schema.String) }),
  Schema.Struct({ _tag: Schema.String }),
]);

/** Served over WebSocket on the agent port. The agent is always the client. */
export class AgentRpcs extends RpcGroup.make(
  /** Holds the connection open. The machine is online for as long as this stream runs. */
  Rpc.make("Connect", {
    payload: { info: MachineInfo, capabilities: AdvertisedCapabilities },
    success: ReceivedCommand,
    stream: true,
  }),
  Rpc.make("Report", { payload: { report: ReceivedReport } }),
  /** Sent when the machine's owner changes its policy while connected. */
  Rpc.make("Advertise", { payload: { capabilities: AgentCapabilities } }),
  Rpc.make("ReportAction", { payload: { runId: RunId, update: ReceivedUpdate } }),
  /** Answers a `CreateFolder` command. */
  Rpc.make("ReportFolder", { payload: { requestId: Schema.String, outcome: FolderOutcome } }),
  Rpc.make("ReportUsage", { payload: { usage: SystemUsage } }),
  /** Answers an `Inspect` command. */
  Rpc.make("ReportInspection", {
    payload: { requestId: Schema.String, result: InspectionResult },
  }),
  /**
   * Sent every `heartbeatSeconds`. The hub ends a connection that goes quiet, because a sleeping or
   * disconnected machine never closes its socket.
   */
  Rpc.make("Heartbeat"),
).middleware(AgentAuthentication) {}

export const heartbeatSeconds = 15;
export const heartbeatTimeoutSeconds = 3 * heartbeatSeconds;
