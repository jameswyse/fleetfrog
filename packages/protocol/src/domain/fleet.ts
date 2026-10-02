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

/** How a request to create a project folder went. */
export const FolderOutcome = Schema.TaggedUnion({
  Created: {},
  /** A folder was there already, so nothing changed. */
  AlreadyThere: {},
  Failed: { message: ReportedText },
});
export type FolderOutcome = typeof FolderOutcome.Type;

/** What the agent found at a discovery folder, or the Archive folder, on its last walk. */
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
  /** Where archived checkouts go, which may start with `~`. Null while archiving is off. */
  archiveFolder: Schema.NullOr(Schema.String),
  /** What the agent found at the Archive folder, or null before it looks or while none is set. */
  archiveFolderStatus: Schema.NullOr(FolderStatus),
  /** Completion of the last discovery walk. Until then, absent repositories are unknown, not missing. */
  lastDiscoveryAt: Schema.NullOr(Schema.DateTimeUtc),
  lastStatusAt: Schema.NullOr(Schema.DateTimeUtc),
  pairedAt: Schema.DateTimeUtc,
  /** The latest disk and load readings, kept while the machine is offline. */
  usage: Schema.NullOr(SystemUsage),
  /** Checkouts in the machine's trash, as it last reported them. */
  trash: Schema.Array(TrashedCheckout),
  /** What the agent last read from T3 Code, or null while the integration is off or before a read. */
  t3Code: Schema.NullOr(T3CodeStatus),
  /** How updating the agent to the hub's version is going, or null when it isn't being updated. */
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
  /** The repository's own name, which a clone's folder takes. */
  name: Schema.String,
  /**
   * What the dashboard shows: T3 Code's name for the project, or the name, prefixed by its owner
   * when another repository shares it.
   */
  label: Schema.String,
  /** T3 Code's icon for the project, or null to show the repository's host. */
  icon: Schema.NullOr(ProjectIcon),
  checkouts: Schema.Array(MachineCheckout),
});
export type Repository = typeof Repository.Type;

/** Everything the dashboard shows, sent whole whenever something changes. */
export const Fleet = Schema.Struct({
  /** The hub's version, which is also the version its agents should run. */
  hubVersion: Schema.String,
  machines: Schema.Array(Machine),
  /** Repositories with checkouts in the machines' project folders. */
  repositories: Schema.Array(Repository),
  /** Repositories with checkouts in the Archive folder, grouped the same way. */
  archive: Schema.Array(Repository),
  polling: PollingSettings,
  integrations: IntegrationSettings,
});
export type Fleet = typeof Fleet.Type;

/** The kind that picks the machine's icon: the owner's choice, what the agent detected, or a server. */
export function machineKind(machine: Pick<Machine, "customKind" | "info">): MachineKind {
  return machine.customKind ?? machine.info.system?.kind ?? "server";
}

export function machineLabel(machine: Pick<Machine, "customName" | "info">): string {
  return machine.customName ?? machine.info.prettyName ?? machine.info.hostname;
}
