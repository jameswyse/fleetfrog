import path from "node:path";

import { DateTime, Effect } from "effect";

import { ActionOutcome, ActionResult, SkipReason } from "@fleetfrog/protocol/domain/action";
import { archiveDestination, unarchiveDestination } from "@fleetfrog/protocol/domain/archiveFolder";
import { isWithin } from "@fleetfrog/protocol/domain/cloneDestination";

import { removeArchiveRecord, writeArchiveRecord } from "../archive/archiveRecord.ts";
import { archivePath } from "../discovery/discoverCheckouts.ts";
import { movableProblem, moveFolder, unmoved } from "./movableCheckout.ts";

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

    const problem = yield* movableProblem(location);

    if (problem !== null) {
      return problem;
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

    const notMoved = unmoved(
      yield* moveFolder({ from: location.path, to: destination }),
      destination,
    );

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

  const notMoved = unmoved(
    yield* moveFolder({ from: location.path, to: destination }),
    destination,
  );

  if (notMoved !== null) {
    return notMoved;
  }

  yield* removeArchiveRecord(path.join(destination, ".git"));
  output.write(`Moved ${location.path} to ${destination}\n`);

  return ActionOutcome.cases.Succeeded.make({
    result: ActionResult.cases.Unarchived.make({ path: destination }),
  });
});
