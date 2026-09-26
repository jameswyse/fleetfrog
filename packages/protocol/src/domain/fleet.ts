import { Schema } from "effect";

import { AgentCapabilities } from "./action.ts";
import { Checkout } from "./checkout.ts";
import { MachineId, MachineInfo, MachineKind, SystemUsage } from "./machine.ts";
import { PollingSettings } from "./polling.ts";
import { RepositoryIdentity, RepositoryKey } from "./repositoryIdentity.ts";

export const Connection = Schema.TaggedUnion({
  Online: { since: Schema.DateTimeUtc, capabilities: AgentCapabilities },
  Offline: { lastSeenAt: Schema.NullOr(Schema.DateTimeUtc) },
});
export type Connection = typeof Connection.Type;

/** How a request to create a project folder went. */
export const FolderOutcome = Schema.TaggedUnion({
  Created: {},
  /** A folder was there already, so nothing changed. */
  AlreadyThere: {},
  Failed: { message: Schema.String },
});
export type FolderOutcome = typeof FolderOutcome.Type;

/** What the agent found at a discovery folder on its last walk. */
export const FolderStatus = Schema.Literals(["Folder", "Missing", "NotFolder"]);
export type FolderStatus = typeof FolderStatus.Type;

export const DiscoveryRoot = Schema.Struct({
  path: Schema.String,
  /** Null until the agent walks the folder for the first time. */
  status: Schema.NullOr(FolderStatus),
});
export type DiscoveryRoot = typeof DiscoveryRoot.Type;

export const Machine = Schema.Struct({
  id: MachineId,
  info: MachineInfo,
  /** The dashboard's name for the machine, overriding the pretty name and hostname. */
  customName: Schema.NullOr(Schema.String),
  /** The owner's choice of kind, overriding the one the agent detected. */
  customKind: Schema.NullOr(MachineKind),
  connection: Connection,
  /** In the owner's order. The first is the default destination for clones. */
  discoveryRoots: Schema.Array(DiscoveryRoot),
  /** Completion of the last discovery walk. Until then, absent repositories are unknown, not missing. */
  lastDiscoveryAt: Schema.NullOr(Schema.DateTimeUtc),
  lastStatusAt: Schema.NullOr(Schema.DateTimeUtc),
  pairedAt: Schema.DateTimeUtc,
  /** The latest disk and load readings, kept while the machine is offline. */
  usage: Schema.NullOr(SystemUsage),
});
export type Machine = typeof Machine.Type;

export const MachineCheckout = Schema.Struct({
  machineId: MachineId,
  checkout: Checkout,
});
export type MachineCheckout = typeof MachineCheckout.Type;

export const Repository = Schema.Struct({
  key: RepositoryKey,
  identity: RepositoryIdentity,
  /** The repository's own name, which a clone's folder takes. */
  name: Schema.String,
  /** What the dashboard shows: the name, prefixed by its owner when another repository shares it. */
  label: Schema.String,
  checkouts: Schema.Array(MachineCheckout),
});
export type Repository = typeof Repository.Type;

/** Everything the dashboard shows, sent whole whenever something changes. */
export const Fleet = Schema.Struct({
  machines: Schema.Array(Machine),
  repositories: Schema.Array(Repository),
  polling: PollingSettings,
});
export type Fleet = typeof Fleet.Type;

/** The kind that picks the machine's icon: the owner's choice, what the agent detected, or a server. */
export function machineKind(machine: Pick<Machine, "customKind" | "info">): MachineKind {
  return machine.customKind ?? machine.info.system?.kind ?? "server";
}

export function machineLabel(machine: Pick<Machine, "customName" | "info">): string {
  return machine.customName ?? machine.info.prettyName ?? machine.info.hostname;
}
