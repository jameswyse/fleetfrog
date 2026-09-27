import path from "node:path";

import { DateTime, Effect, Option } from "effect";

import { ActionResult, SkipReason } from "@fleetfrog/protocol/domain/action";
import { archiveDestination, unarchiveDestination } from "@fleetfrog/protocol/domain/archiveFolder";
import { isWithin } from "@fleetfrog/protocol/domain/cloneDestination";

import {
  readArchiveRecord,
  removeArchiveRecord,
  writeArchiveRecord,
} from "../archive/archiveRecord.ts";
import { archivePath } from "../discovery/discoverCheckouts.ts";
import { performCheckoutMove, planCheckoutMove } from "./checkoutMove.ts";
import { exists, movableProblem } from "./movableCheckout.ts";
import { failed, failedWith, skipped, succeeded } from "./outcomes.ts";

import type { CheckoutLocation } from "../git/readCheckout.ts";
import type { ActionOutput } from "./actionOutput.ts";
import type { Move } from "./checkoutMove.ts";

/** What the machine's configuration says about where checkouts live. */
export interface Folders {
  readonly roots: ReadonlyArray<string>;
  readonly archiveFolder: string | null;
  readonly home: string;
}

/**
 * Moves a checkout into the Archive folder, at the same path below it as it had below its project
 * folder, and records where it came from. Its linked worktrees move too, each the same way, and
 * Git relinks them. Nothing moves if any destination is taken or two would clash.
 */
export const archiveCheckout = Effect.fn("archiveCheckout")(
  function* (location: CheckoutLocation, folders: Folders, output: ActionOutput) {
    const archive = archivePath(folders);

    if (archive === null) {
      return skipped(SkipReason.cases.NoArchiveFolder.make({}));
    }

    const problem = movableProblem(location);

    if (problem !== null) {
      return problem;
    }

    const destination = archiveDestination({ path: location.path, archive, ...folders });

    if (isWithin(destination, location.path)) {
      return failed("The Archive folder is inside this checkout.");
    }

    const planned = yield* planCheckoutMove({
      location,
      destination,
      worktreeDestination: (worktree) =>
        archiveDestination({ path: worktree, archive, ...folders }),
    });

    if (planned._tag === "Refused") {
      return planned.outcome;
    }

    const record = (worktrees: ReadonlyArray<Move>, archivedAt: DateTime.Utc) => ({
      originalPath: location.path,
      archivedAt,
      worktrees: worktrees.map(({ from, to }) => ({ originalPath: from, archivedPath: to })),
    });
    const archivedAt = yield* DateTime.now;
    const unrecorded = yield* writeArchiveRecord(
      location.commonDirectory,
      record(planned.move.separate, archivedAt),
    );

    if (unrecorded !== null) {
      return failed(unrecorded);
    }

    const result = yield* performCheckoutMove(planned.move, output);

    if (result._tag === "NotMoved") {
      yield* removeArchiveRecord(location.commonDirectory);

      return result.outcome;
    }

    // The record travelled with the checkout. It now lists only the worktrees that moved.
    yield* writeArchiveRecord(path.join(destination, ".git"), record(result.worktrees, archivedAt));

    return succeeded(
      ActionResult.cases.Archived.make({ path: destination, worktrees: result.worktrees }),
    );
  },
  Effect.catchTag("CommandFailed", failedWith),
);

/**
 * Moves an archived checkout back where it was archived from, or below the first project folder
 * when that place is no longer in one, with the worktrees archived alongside it that are still
 * where they were left. Every worktree is relinked, including ones that stay.
 */
export const unarchiveCheckout = Effect.fn("unarchiveCheckout")(
  function* (location: CheckoutLocation, folders: Folders, output: ActionOutput) {
    const archive = archivePath(folders);

    if (archive === null) {
      return skipped(SkipReason.cases.NoArchiveFolder.make({}));
    }

    // A linked worktree goes back with its main checkout, never on its own.
    if (location.worktree._tag === "Linked") {
      return skipped(SkipReason.cases.IsWorktree.make({}));
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

    const record = yield* readArchiveRecord(location.commonDirectory);
    const returning = new Map<string, string>();

    for (const { originalPath, archivedPath } of Option.isSome(record)
      ? record.value.worktrees
      : []) {
      // One moved or removed since, or whose old place is taken, stays where it is.
      if (!(yield* exists(originalPath))) {
        returning.set(archivedPath, originalPath);
      }
    }

    const planned = yield* planCheckoutMove({
      location,
      destination,
      worktreeDestination: (worktree) => returning.get(worktree) ?? null,
    });

    if (planned._tag === "Refused") {
      return planned.outcome;
    }

    const result = yield* performCheckoutMove(planned.move, output);

    if (result._tag === "NotMoved") {
      return result.outcome;
    }

    yield* removeArchiveRecord(path.join(destination, ".git"));

    return succeeded(
      ActionResult.cases.Unarchived.make({ path: destination, worktrees: result.worktrees }),
    );
  },
  Effect.catchTag("CommandFailed", failedWith),
);
