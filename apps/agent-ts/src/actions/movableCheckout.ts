import { lstat, mkdir, rename } from "node:fs/promises";
import path from "node:path";

import { Effect } from "effect";

import { SkipReason } from "@fleetfrog/protocol/domain/action";

import { countLinkedWorktrees } from "../git/worktrees.ts";
import { failed, skipped } from "./outcomes.ts";

import type { ActionOutcome } from "@fleetfrog/protocol/domain/action";

import type { CheckoutLocation } from "../git/readCheckout.ts";

export function movableProblem(location: CheckoutLocation): ActionOutcome | null {
  if (location.worktree._tag === "Linked") {
    return skipped(SkipReason.cases.IsWorktree.make({}));
  }

  return location.commonDirectory === path.join(location.path, ".git")
    ? null
    : failed("This checkout keeps its Git directory elsewhere, so it can't move safely.");
}

export const worktreesProblem = (location: CheckoutLocation) =>
  countLinkedWorktrees(location).pipe(
    Effect.map((count) =>
      count > 0 ? skipped(SkipReason.cases.HasWorktrees.make({ count })) : null,
    ),
  );

export const exists = (target: string) =>
  Effect.promise(() =>
    lstat(target).then(
      () => true,
      () => false,
    ),
  );

function isCrossDevice(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EXDEV";
}

type MoveResult =
  | { readonly _tag: "Moved" }
  | { readonly _tag: "Taken" }
  | { readonly _tag: "Failed"; readonly message: string };

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

export function unmoved(result: MoveResult, destination: string): ActionOutcome | null {
  if (result._tag === "Taken") {
    return skipped(SkipReason.cases.DestinationTaken.make({ path: destination }));
  }

  return result._tag === "Failed" ? failed(result.message) : null;
}
