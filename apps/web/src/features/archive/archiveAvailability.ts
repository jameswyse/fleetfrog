import {
  archiveDestination,
  checkArchiveFolder,
  unarchiveDestination,
} from "@fleetfrog/protocol/domain/archiveFolder";
import { expandHome, isWithin } from "@fleetfrog/protocol/domain/cloneDestination";

import { machineBlocker } from "../actions/actionAvailability.ts";

import type { Checkout, LinkedWorktree } from "@fleetfrog/protocol/domain/checkout";
import type { Machine } from "@fleetfrog/protocol/domain/fleet";

export interface FolderMove {
  readonly from: string;
  readonly to: string;
}

export type ArchivePlan =
  | {
      readonly _tag: "Ready";
      readonly destination: string;
      readonly worktrees: ReadonlyArray<FolderMove>;
    }
  | { readonly _tag: "NeedsFolder"; readonly problem: string | null }
  | { readonly _tag: "Blocked"; readonly reason: string };

export type UnarchivePlan =
  | { readonly _tag: "Ready"; readonly destination: string }
  | { readonly _tag: "Blocked"; readonly reason: string };

function roots(machine: Machine): ReadonlyArray<string> {
  return machine.discoveryRoots.map(({ path }) => path);
}

const unusableFolderReason =
  "The Archive folder holds one of this machine's project folders, so the agent ignores it";

function archiveFolderUsable(machine: Machine): boolean {
  return (
    machine.archiveFolder !== null &&
    checkArchiveFolder({
      folder: machine.archiveFolder,
      home: machine.info.homeDirectory,
      roots: roots(machine),
    })._tag === "Valid"
  );
}

export function linkedWorktrees(checkout: Checkout): ReadonlyArray<LinkedWorktree> {
  return checkout.status._tag === "Read"
    ? checkout.status.git.worktrees.filter(({ state }) => state !== "Missing")
    : [];
}

export function planArchive(options: {
  readonly machine: Machine;
  readonly checkout: Checkout;
}): ArchivePlan {
  const { machine, checkout } = options;
  const blocked = machineBlocker(machine, "Archive");

  if (blocked !== null) {
    return { _tag: "Blocked", reason: blocked };
  }

  if (checkout.worktree._tag === "Linked") {
    return {
      _tag: "Blocked",
      reason: "It's a linked worktree. Archiving its main checkout takes it along",
    };
  }

  if (machine.archiveFolder === null) {
    return { _tag: "NeedsFolder", problem: null };
  }

  if (!archiveFolderUsable(machine)) {
    return { _tag: "NeedsFolder", problem: unusableFolderReason };
  }

  const archive = expandHome(machine.archiveFolder, machine.info.homeDirectory);

  const destinationOf = (path: string) =>
    archiveDestination({
      path,
      archive,
      home: machine.info.homeDirectory,
      roots: roots(machine),
    });

  return {
    _tag: "Ready",
    destination: destinationOf(checkout.path),
    worktrees: linkedWorktrees(checkout)
      .filter(({ path }) => !isWithin(path, checkout.path))
      .map(({ path }) => ({ from: path, to: destinationOf(path) })),
  };
}

export function planUnarchive(options: {
  readonly machine: Machine;
  readonly checkout: Checkout;
}): UnarchivePlan {
  const { machine, checkout } = options;
  const blocked = machineBlocker(machine, "Unarchive");

  if (blocked !== null) {
    return { _tag: "Blocked", reason: blocked };
  }

  if (machine.archiveFolder === null) {
    return { _tag: "Blocked", reason: "The machine has no Archive folder set" };
  }

  if (!archiveFolderUsable(machine)) {
    return {
      _tag: "Blocked",
      reason: `${unusableFolderReason}. Change it in the machine's settings`,
    };
  }

  const destination = unarchiveDestination({
    path: checkout.path,
    originalPath: checkout.placement._tag === "Archive" ? checkout.placement.originalPath : null,
    archive: expandHome(machine.archiveFolder, machine.info.homeDirectory),
    home: machine.info.homeDirectory,
    roots: roots(machine),
  });

  return destination === null
    ? {
        _tag: "Blocked",
        reason:
          "The machine has no project folders to move it back into. Add one in the machine's settings",
      }
    : { _tag: "Ready", destination };
}
