import { lstat, mkdir, rename } from "node:fs/promises";
import path from "node:path";

import { Effect } from "effect";

import { ActionOutcome, SkipReason } from "@fleetfrog/protocol/domain/action";

import { countLinkedWorktrees } from "../inspect/inspectCheckout.ts";

import type { CheckoutLocation } from "../git/readCheckout.ts";

const failed = (message: string) => ActionOutcome.cases.Failed.make({ message });
const skipped = (reason: SkipReason) => ActionOutcome.cases.Skipped.make({ reason });

/**
 * Why the checkout can't leave its place as a whole, or null when it can: only a main checkout
 * whose Git directory is inside it, without linked worktrees that the move would break.
 */
export const movableProblem = (location: CheckoutLocation) =>
  Effect.gen(function* () {
    if (location.worktree._tag === "Linked") {
      return skipped(SkipReason.cases.IsWorktree.make({}));
    }

    if (location.commonDirectory !== path.join(location.path, ".git")) {
      return failed("This checkout keeps its Git directory elsewhere, so it can't move safely.");
    }

    const worktrees = yield* countLinkedWorktrees(location);

    return worktrees > 0 ? skipped(SkipReason.cases.HasWorktrees.make({ count: worktrees })) : null;
  });

/** Whether a rename failed because its two paths are on different disks. */
function isCrossDevice(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EXDEV";
}

type MoveResult =
  | { readonly _tag: "Moved" }
  /** Something is already at the destination, so nothing moved. */
  | { readonly _tag: "Taken" }
  | { readonly _tag: "Failed"; readonly message: string };

/**
 * Moves a checkout's folder, creating the folders above its new place. The move is a rename, so it
 * happens at once or not at all, and only within one disk.
 */
export const moveFolder = ({ from, to }: { readonly from: string; readonly to: string }) =>
  Effect.promise(async (): Promise<MoveResult> => {
    const taken = await lstat(to).then(
      () => true,
      () => false,
    );

    if (taken) {
      return { _tag: "Taken" };
    }

    try {
      await mkdir(path.dirname(to), { recursive: true });
      await rename(from, to);

      return { _tag: "Moved" };
    } catch (error) {
      return {
        _tag: "Failed",
        message: isCrossDevice(error)
          ? `${to} is on a different disk from ${from}, and FleetFrog only moves checkouts within one disk.`
          : `Couldn't move ${from} to ${to}: ${String(error)}`,
      };
    }
  });

/** The outcome of a move that didn't happen, or null when it did. */
export function unmoved(result: MoveResult, destination: string): ActionOutcome | null {
  if (result._tag === "Taken") {
    return skipped(SkipReason.cases.DestinationTaken.make({ path: destination }));
  }

  return result._tag === "Failed" ? failed(result.message) : null;
}
