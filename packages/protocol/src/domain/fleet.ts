import { Schema } from "effect";

import { AgentCapabilities } from "./action.ts";
import { AgentUpdate } from "./agentUpdate.ts";
import { Checkout } from "./checkout.ts";
import { MachineId, MachineInfo, MachineKind, SystemUsage } from "./machine.ts";
import { PollingSettings } from "./polling.ts";
import { ReportedText } from "./reported.ts";
import { RepositoryIdentity, RepositoryKey } from "./repositoryIdentity.ts";
import { IntegrationSettings, ProjectIcon, T3CodeStatus } from "./t3Code.ts";
import { TrashedCheckout } from "./trash.ts";

export const Connection = Schema.TaggedUnion({
  Online: { since: Schema.DateTimeUtc, capabilities: AgentCapabilities },
  Offline: { lastSeenAt: Schema.NullOr(Schema.DateTimeUtc) },
});
export type Connection = typeof Connection.Type;

export const FolderOutcome = Schema.TaggedUnion({
  Created: {},
  AlreadyThere: {},
  Failed: { message: ReportedText },
});
export type FolderOutcome = typeof FolderOutcome.Type;

export const FolderStatus = Schema.Literals(["Folder", "Missing", "NotFolder"]);
export type FolderStatus = typeof FolderStatus.Type;

export const DiscoveryRoot = Schema.Struct({
  path: Schema.String,
  status: Schema.NullOr(FolderStatus),
});
export type DiscoveryRoot = typeof DiscoveryRoot.Type;

export const Machine = Schema.Struct({
  id: MachineId,
  info: MachineInfo,
  customName: Schema.NullOr(Schema.String),
  customKind: Schema.NullOr(MachineKind),
  connection: Connection,
  discoveryRoots: Schema.Array(DiscoveryRoot),
  archiveFolder: Schema.NullOr(Schema.String),
  archiveFolderStatus: Schema.NullOr(FolderStatus),
  lastDiscoveryAt: Schema.NullOr(Schema.DateTimeUtc),
  lastStatusAt: Schema.NullOr(Schema.DateTimeUtc),
  pairedAt: Schema.DateTimeUtc,
  usage: Schema.NullOr(SystemUsage),
  trash: Schema.Array(TrashedCheckout),
  t3Code: Schema.NullOr(T3CodeStatus),
  update: Schema.NullOr(AgentUpdate),
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
  name: Schema.String,
  label: Schema.String,
  icon: Schema.NullOr(ProjectIcon),
  checkouts: Schema.Array(MachineCheckout),
});
export type Repository = typeof Repository.Type;

export const Fleet = Schema.Struct({
  hubVersion: Schema.String,
  machines: Schema.Array(Machine),
  repositories: Schema.Array(Repository),
  archive: Schema.Array(Repository),
  polling: PollingSettings,
  integrations: IntegrationSettings,
});
export type Fleet = typeof Fleet.Type;

export function machineKind(machine: Pick<Machine, "customKind" | "info">): MachineKind {
  return machine.customKind ?? machine.info.system?.kind ?? "server";
}

export function machineLabel(machine: Pick<Machine, "customName" | "info">): string {
  return machine.customName ?? machine.info.prettyName ?? machine.info.hostname;
}
