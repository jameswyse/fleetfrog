import { Context, Schema } from "effect";
import { Rpc, RpcGroup, RpcMiddleware } from "effect/unstable/rpc";

import { Checkout } from "../domain/checkout.ts";
import { MachineInfo } from "../domain/machine.ts";

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
});
export type HubCommand = typeof HubCommand.Type;

export const ScanReport = Schema.TaggedUnion({
  /** A completed discovery walk. Replaces every checkout the hub holds for the machine. */
  Discovery: { checkouts: Schema.Array(Checkout), completedAt: Schema.DateTimeUtc },
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
    payload: { info: MachineInfo },
    success: HubCommand,
    stream: true,
  }),
  Rpc.make("Report", { payload: { report: ScanReport } }),
).middleware(AgentAuthentication) {}
