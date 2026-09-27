import { machineBlocker } from "../actions/actionAvailability.ts";

import type { Checkout } from "@fleetfrog/protocol/domain/checkout";
import type { Machine } from "@fleetfrog/protocol/domain/fleet";

/**
 * Why the checkout can't go to the trash, as last scanned, or null when it can. Its linked
 * worktrees go with it.
 */
export function trashBlocker(options: {
  readonly machine: Machine;
  readonly checkout: Checkout;
}): string | null {
  const blocked = machineBlocker(options.machine, "Trash");

  if (blocked !== null) {
    return blocked;
  }

  return options.checkout.worktree._tag === "Linked"
    ? "It's a linked worktree, which goes with its main checkout"
    : null;
}
