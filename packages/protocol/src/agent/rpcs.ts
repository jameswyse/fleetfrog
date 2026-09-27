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
  /** Sent on connect and whenever the roots or schedule change. */
  Configure: { discoveryRoots: Schema.Array(Schema.String), schedule: AgentSchedule },
  /** Rediscover and rescan now. */
  Refresh: {},
  /** Sent only for actions the agent advertised. The agent checks its own policy again. */
  RunAction: { runId: RunId, request: ActionRequest },
  CancelAction: { runId: RunId },
  /**
   * Creates one of the agent's project folders, answered by `ReportFolder` with the same request
   * id. Sent only to agents that advertise `createsFolders`. The agent checks the path itself.
   */
  CreateFolder: { requestId: Schema.String, path: Schema.String },
});
export type HubCommand = typeof HubCommand.Type;

/**
 * A command as the agent receives it. A newer hub may send a command this agent doesn't know, which
 * it skips instead of ending the connection.
 */
export const ReceivedCommand = Schema.Union([HubCommand, Schema.Struct({ _tag: Schema.String })]);

export const ReportedRoot = Schema.Struct({ path: Schema.String, status: FolderStatus });
export type ReportedRoot = typeof ReportedRoot.Type;

export const ScanReport = Schema.TaggedUnion({
  /** A completed discovery walk. Replaces every checkout the hub holds for the machine. */
  Discovery: {
    checkouts: Schema.Array(Checkout),
    /** What the walk found at each discovery folder. Absent from agents that predate it. */
    roots: Schema.Array(ReportedRoot).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
    completedAt: Schema.DateTimeUtc,
  },
  /** A status pass. Carries only checkouts that changed or disappeared since the last report. */
  Status: {
    changed: Schema.Array(Checkout),
    removedPaths: Schema.Array(Schema.String),
    completedAt: Schema.DateTimeUtc,
  },
});
export type ScanReport = typeof ScanReport.Type;

/** Served over WebSocket on the agent port. The agent is always the client. */
export class AgentRpcs extends RpcGroup.make(
  /** Holds the connection open. The machine is online for as long as this stream runs. */
  Rpc.make("Connect", {
    payload: { info: MachineInfo, capabilities: AdvertisedCapabilities },
    success: ReceivedCommand,
    stream: true,
  }),
  Rpc.make("Report", { payload: { report: ScanReport } }),
  /** Sent when the machine's owner changes its policy while connected. */
  Rpc.make("Advertise", { payload: { capabilities: AgentCapabilities } }),
  Rpc.make("ReportAction", { payload: { runId: RunId, update: ActionUpdate } }),
  /** Answers a `CreateFolder` command. */
  Rpc.make("ReportFolder", { payload: { requestId: Schema.String, outcome: FolderOutcome } }),
  Rpc.make("ReportUsage", { payload: { usage: SystemUsage } }),
  /**
   * Sent every `heartbeatSeconds`. The hub ends a connection that goes quiet, because a sleeping or
   * disconnected machine never closes its socket.
   */
  Rpc.make("Heartbeat"),
).middleware(AgentAuthentication) {}

export const heartbeatSeconds = 15;
export const heartbeatTimeoutSeconds = 3 * heartbeatSeconds;
