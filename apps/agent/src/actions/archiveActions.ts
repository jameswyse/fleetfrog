import { lstat } from "node:fs/promises";
import path from "node:path";

import { DateTime, Effect, Option } from "effect";

import { ActionOutcome, ActionResult, SkipReason } from "@fleetfrog/protocol/domain/action";
import { archiveDestination, unarchiveDestination } from "@fleetfrog/protocol/domain/archiveFolder";
import { isWithin } from "@fleetfrog/protocol/domain/cloneDestination";

import {
  readArchiveRecord,
  removeArchiveRecord,
  writeArchiveRecord,
} from "../archive/archiveRecord.ts";
import { archivePath } from "../discovery/discoverCheckouts.ts";
import { readLinkedWorktrees } from "../git/worktrees.ts";
import { runGitAction } from "../process/runTool.ts";
import { movableProblem, moveFolder, unmoved } from "./movableCheckout.ts";
import { failed, skipped } from "./outcomes.ts";

import type { CheckoutLocation } from "../git/readCheckout.ts";
import type { ActionOutput } from "./actionOutput.ts";

/** What the machine's configuration says about where checkouts live. */
export interface Folders {
  readonly roots: ReadonlyArray<string>;
  readonly archiveFolder: string | null;
  readonly home: string;
}

/** A folder to move, and where to. */
interface Move {
  readonly from: string;
  readonly to: string;
}

/** Whether something is already at the path. */
const exists = (target: string) =>
  Effect.promise(() =>
    lstat(target).then(
      () => true,
      () => false,
    ),
  );

/**
 * Moves each linked worktree after its main checkout has moved, then has Git repair the links both
 * ways from the main checkout's new place. A worktree that couldn't move is repaired where it is.
 * Returns the moves that happened.
 */
const moveWorktrees = Effect.fn("moveWorktrees")(function* (options: {
  readonly main: string;
  readonly moves: ReadonlyArray<Move>;
  readonly output: ActionOutput;
}) {
  const moved: Array<Move> = [];
  const stayed: Array<string> = [];

  for (const move of options.moves) {
    const result = yield* moveFolder(move);

    if (result._tag === "Moved") {
      moved.push(move);
    } else {
      stayed.push(move.from);
      options.output.write(
        `Couldn't move the worktree at ${move.from}: ${result._tag === "Taken" ? `something is already at ${move.to}` : result.message}\n`,
      );
    }
  }

  const repaired = [...moved.map(({ to }) => to), ...stayed];

  if (repaired.length > 0) {
    yield* runGitAction({
      cwd: options.main,
      args: ["worktree", "repair", ...repaired],
      onOutput: options.output.write,
    }).pipe(
      Effect.catchTag("CommandFailed", ({ message }) =>
        Effect.sync(() => options.output.write(`Couldn't repair the worktrees: ${message}\n`)),
      ),
    );
  }

  return moved;
});

/**
 * Moves a checkout into the Archive folder, at the same path below it as it had below its project
 * folder, and records where it came from. Its linked worktrees move too, each the same way, and
 * Git repairs their links. Nothing moves if any destination is taken.
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

    // A worktree inside the checkout's own folder moves with it.
    const worktrees: ReadonlyArray<Move> = (yield* readLinkedWorktrees(location))
      .filter(
        ({ state, path: worktree }) => state !== "Missing" && !isWithin(worktree, location.path),
      )
      .map(({ path: worktree }) => ({
        from: worktree,
        to: archiveDestination({ path: worktree, archive, ...folders }),
      }));

    for (const target of [destination, ...worktrees.map(({ to }) => to)]) {
      if (yield* exists(target)) {
        return skipped(SkipReason.cases.DestinationTaken.make({ path: target }));
      }
    }

    const unrecorded = yield* writeArchiveRecord(location.commonDirectory, {
      originalPath: location.path,
      archivedAt: yield* DateTime.now,
      worktrees: worktrees.map(({ from, to }) => ({ originalPath: from, archivedPath: to })),
    });

    if (unrecorded !== null) {
      return failed(unrecorded);
    }

    const notMoved = unmoved(
      yield* moveFolder({ from: location.path, to: destination }),
      destination,
    );

    if (notMoved !== null) {
      yield* removeArchiveRecord(location.commonDirectory);

      return notMoved;
    }

    output.write(`Moved ${location.path} to ${destination}\n`);

    const moved = yield* moveWorktrees({ main: destination, moves: worktrees, output });

    return ActionOutcome.cases.Succeeded.make({
      result: ActionResult.cases.Archived.make({ path: destination, worktrees: moved }),
    });
  },
  Effect.catchTag("CommandFailed", ({ message }) => Effect.succeed(failed(message))),
);

/**
 * Moves an archived checkout back where it was archived from, or below the first project folder
 * when that place is no longer in one, with the worktrees that were archived with it.
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
  const archivedWorktrees = Option.isSome(record) ? record.value.worktrees : [];
  const notMoved = unmoved(
    yield* moveFolder({ from: location.path, to: destination }),
    destination,
  );

  if (notMoved !== null) {
    return notMoved;
  }

  const main = path.join(destination, ".git");

  yield* removeArchiveRecord(main);
  output.write(`Moved ${location.path} to ${destination}\n`);

  // Worktrees still where they were archived go back; any moved or removed since are left.
  const moves: Array<Move> = [];

  for (const { originalPath, archivedPath } of archivedWorktrees) {
    if ((yield* exists(archivedPath)) && !(yield* exists(originalPath))) {
      moves.push({ from: archivedPath, to: originalPath });
    }
  }

  const moved = yield* moveWorktrees({ main: destination, moves, output });

  return ActionOutcome.cases.Succeeded.make({
    result: ActionResult.cases.Unarchived.make({ path: destination, worktrees: moved }),
  });
});
