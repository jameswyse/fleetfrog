import { archiveDestination, unarchiveDestination } from "@fleetfrog/protocol/domain/archiveFolder";
import { clonePath } from "@fleetfrog/protocol/domain/checkout";
import { expandHome } from "@fleetfrog/protocol/domain/cloneDestination";

import { machineBlocker } from "../actions/actionAvailability.ts";

import type { Checkout } from "@fleetfrog/protocol/domain/checkout";
import type { Fleet, Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

export type ArchivePlan =
  | { readonly _tag: "Ready"; readonly destination: string }
  | { readonly _tag: "Blocked"; readonly reason: string };

function roots(machine: Machine): ReadonlyArray<string> {
  return machine.discoveryRoots.map(({ path }) => path);
}

/** Where archiving the checkout would move it, or why it can't be archived, as last scanned. */
export function planArchive(options: {
  readonly fleet: Fleet;
  readonly repository: Repository;
  readonly machine: Machine;
  readonly checkout: Checkout;
}): ArchivePlan {
  const { fleet, machine, checkout } = options;
  const blocked = machineBlocker(machine, "Archive");

  if (blocked !== null) {
    return { _tag: "Blocked", reason: blocked };
  }

  if (fleet.archiveFolder === null) {
    return { _tag: "Blocked", reason: "Set an Archive folder in Settings first" };
  }

  if (checkout.worktree._tag === "Linked") {
    return {
      _tag: "Blocked",
      reason: "It's a linked worktree. Archive its main checkout once its worktrees are removed",
    };
  }

  const worktrees = options.repository.checkouts.filter(
    (entry) =>
      entry.machineId === machine.id &&
      entry.checkout.worktree._tag === "Linked" &&
      clonePath(entry.checkout) === checkout.path,
  ).length;

  if (worktrees > 0) {
    return {
      _tag: "Blocked",
      reason: `Remove its ${worktrees === 1 ? "linked worktree" : `${worktrees} linked worktrees`} first, since moving it would break them`,
    };
  }

  return {
    _tag: "Ready",
    destination: archiveDestination({
      path: checkout.path,
      archive: expandHome(fleet.archiveFolder, machine.info.homeDirectory),
      home: machine.info.homeDirectory,
      roots: roots(machine),
    }),
  };
}

/** Where unarchiving the checkout would move it back to, or why it can't move back. */
export function planUnarchive(options: {
  readonly fleet: Fleet;
  readonly machine: Machine;
  readonly checkout: Checkout;
}): ArchivePlan {
  const { fleet, machine, checkout } = options;
  const blocked = machineBlocker(machine, "Unarchive");

  if (blocked !== null) {
    return { _tag: "Blocked", reason: blocked };
  }

  if (fleet.archiveFolder === null) {
    return { _tag: "Blocked", reason: "No Archive folder is set" };
  }

  const destination = unarchiveDestination({
    path: checkout.path,
    originalPath: checkout.placement._tag === "Archive" ? checkout.placement.originalPath : null,
    archive: expandHome(fleet.archiveFolder, machine.info.homeDirectory),
    home: machine.info.homeDirectory,
    roots: roots(machine),
  });

  return destination === null
    ? { _tag: "Blocked", reason: "The machine has no project folders to move it back into" }
    : { _tag: "Ready", destination };
}
