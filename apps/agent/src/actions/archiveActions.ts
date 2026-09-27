import { lstat, mkdir, rename } from "node:fs/promises";
import path from "node:path";

import { DateTime, Effect } from "effect";

import { ActionOutcome, ActionResult, SkipReason } from "@fleetfrog/protocol/domain/action";
import { archiveDestination, unarchiveDestination } from "@fleetfrog/protocol/domain/archiveFolder";
import { isWithin } from "@fleetfrog/protocol/domain/cloneDestination";

import { removeArchiveRecord, writeArchiveRecord } from "../archive/archiveRecord.ts";
import { archivePath } from "../discovery/discoverCheckouts.ts";
import { runGit } from "../process/runTool.ts";

import type { CheckoutLocation } from "../git/readCheckout.ts";
import type { ActionOutput } from "./actionOutput.ts";

const failed = (message: string) => ActionOutcome.cases.Failed.make({ message });
const skipped = (reason: SkipReason) => ActionOutcome.cases.Skipped.make({ reason });

/** What the machine's configuration says about where checkouts live. */
export interface Folders {
  readonly roots: ReadonlyArray<string>;
  readonly archiveFolder: string | null;
  readonly home: string;
}

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
const moveFolder = (from: string, to: string) =>
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
function unmoved(result: MoveResult, destination: string): ActionOutcome | null {
  if (result._tag === "Taken") {
    return skipped(SkipReason.cases.DestinationTaken.make({ path: destination }));
  }

  return result._tag === "Failed" ? failed(result.message) : null;
}

/** Linked worktrees of the repository that still exist, which a move would break. */
const linkedWorktrees = (location: CheckoutLocation) =>
  runGit(location.path, ["worktree", "list", "--porcelain"]).pipe(
    Effect.map(
      (output) =>
        output
          .split("\n\n")
          .filter((record) => record.trim() !== "" && !record.includes("\nprunable")).length - 1,
    ),
  );

/**
 * Moves a checkout into the Archive folder, at the same path below it as it had below its project
 * folder, and records where it came from. Only a main checkout without linked worktrees can move,
 * since moving would break their links.
 */
export const archiveCheckout = Effect.fn("archiveCheckout")(
  function* (location: CheckoutLocation, folders: Folders, output: ActionOutput) {
    const archive = archivePath(folders);

    if (archive === null) {
      return skipped(SkipReason.cases.NoArchiveFolder.make({}));
    }

    if (location.worktree._tag === "Linked") {
      return skipped(SkipReason.cases.IsWorktree.make({}));
    }

    if (location.commonDirectory !== path.join(location.path, ".git")) {
      return failed("This checkout keeps its Git directory elsewhere, so it can't move safely.");
    }

    const worktrees = yield* linkedWorktrees(location);

    if (worktrees > 0) {
      return skipped(SkipReason.cases.HasWorktrees.make({ count: worktrees }));
    }

    const destination = archiveDestination({ path: location.path, archive, ...folders });

    if (isWithin(destination, location.path)) {
      return failed("The Archive folder is inside this checkout.");
    }

    const unrecorded = yield* writeArchiveRecord(location.commonDirectory, {
      originalPath: location.path,
      archivedAt: yield* DateTime.now,
    });

    if (unrecorded !== null) {
      return failed(unrecorded);
    }

    const notMoved = unmoved(yield* moveFolder(location.path, destination), destination);

    if (notMoved !== null) {
      yield* removeArchiveRecord(location.commonDirectory);

      return notMoved;
    }

    output.write(`Moved ${location.path} to ${destination}\n`);

    return ActionOutcome.cases.Succeeded.make({
      result: ActionResult.cases.Archived.make({ path: destination }),
    });
  },
  Effect.catchTag("CommandFailed", ({ message }) => Effect.succeed(failed(message))),
);

/**
 * Moves an archived checkout back where it was archived from, or below the first project folder
 * when that place is no longer in one.
 */
export const unarchiveCheckout = Effect.fn("unarchiveCheckout")(function* (
  location: CheckoutLocation,
  folders: Folders,
  output: ActionOutput,
) {
  const archive = archivePath(folders);

  if (archive === null) {
    return skipped(SkipReason.cases.NoArchiveFolder.make({}));
  }

  const destination = unarchiveDestination({
    path: location.path,
    originalPath: location.placement._tag === "Archive" ? location.placement.originalPath : null,
    archive,
    ...folders,
  });

  if (destination === null) {
    return failed("This machine has no project folders to move the checkout back into.");
  }

  const notMoved = unmoved(yield* moveFolder(location.path, destination), destination);

  if (notMoved !== null) {
    return notMoved;
  }

  yield* removeArchiveRecord(path.join(destination, ".git"));
  output.write(`Moved ${location.path} to ${destination}\n`);

  return ActionOutcome.cases.Succeeded.make({
    result: ActionResult.cases.Unarchived.make({ path: destination }),
  });
});
