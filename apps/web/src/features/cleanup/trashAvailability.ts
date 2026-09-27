import { plural } from "@/ui/plural.ts";

import { machineBlocker } from "../actions/actionAvailability.ts";
import { linkedWorktrees } from "../archive/archiveAvailability.ts";

import type { Checkout } from "@fleetfrog/protocol/domain/checkout";
import type { Machine } from "@fleetfrog/protocol/domain/fleet";

/** Why the checkout can't go to the trash, as last scanned, or null when it can. */
export function trashBlocker(options: {
  readonly machine: Machine;
  readonly checkout: Checkout;
}): string | null {
  const blocked = machineBlocker(options.machine, "Trash");

  if (blocked !== null) {
    return blocked;
  }

  if (options.checkout.worktree._tag === "Linked") {
    return "It's a linked worktree, which goes with its main checkout";
  }

  const worktrees = linkedWorktrees(options.checkout).length;

  return worktrees > 0
    ? `Remove its ${plural(worktrees, "linked worktree")} first, under Linked worktrees`
    : null;
}
