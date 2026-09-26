import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import { Fleet } from "../domain/fleet.ts";
import { MachineId } from "../domain/machine.ts";
import { PollingSettings } from "../domain/polling.ts";

export class MachineNotFound extends Schema.TaggedError<MachineNotFound>()("MachineNotFound", {
  machineId: MachineId,
}) {}

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
  Rpc.make("SetDiscoveryRoots", {
    payload: { machineId: MachineId, roots: Schema.Array(Schema.NonEmptyString) },
    error: MachineNotFound,
  }),
  Rpc.make("RemoveMachine", { payload: { machineId: MachineId }, error: MachineNotFound }),
  Rpc.make("UpdatePolling", { payload: { polling: PollingSettings } }),
  Rpc.make("CreatePairingOffer", { success: PairingOffer }),
) {}
