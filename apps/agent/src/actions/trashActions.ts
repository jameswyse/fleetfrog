import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";

import { DateTime, Effect, Option } from "effect";

import { ActionOutcome, ActionResult, SkipReason } from "@fleetfrog/protocol/domain/action";
import { isWithin } from "@fleetfrog/protocol/domain/cloneDestination";
import { nothingUnique, TrashId } from "@fleetfrog/protocol/domain/trash";

import { readGitStatus } from "../git/readCheckout.ts";
import { fingerprintCheckout, inspectCheckout, readIgnored } from "../inspect/inspectCheckout.ts";
import { diskUsage } from "../process/diskUsage.ts";
import {
  itemCheckoutPath,
  readTrashItem,
  removeTrashItem,
  writeTrashItem,
} from "../trash/trashFolder.ts";
import { movableProblem, moveFolder, unmoved } from "./movableCheckout.ts";

import type { TrashedCheckout } from "@fleetfrog/protocol/domain/trash";

import type { CheckoutLocation } from "../git/readCheckout.ts";
import type { InspectionOptions } from "../inspect/inspectCheckout.ts";
import type { ActionOutput } from "./actionOutput.ts";

const failed = (message: string) => ActionOutcome.cases.Failed.make({ message });
const skipped = (reason: SkipReason) => ActionOutcome.cases.Skipped.make({ reason });
const succeeded = (result: ActionResult) => ActionOutcome.cases.Succeeded.make({ result });

/** What a folder takes up on disk. */
const sizeOf = (folder: string) =>
  diskUsage(path.dirname(folder), [path.basename(folder)]).pipe(Effect.map(([bytes = 0]) => bytes));

/**
 * Deletes cache folders inside `folder`, returning the bytes they took up and any that couldn't be
 * deleted. `rm` removes a symbolic link itself, never what it points at.
 */
const removeCaches = (folder: string, caches: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const inside = caches.filter((entry) => isWithin(path.resolve(folder, entry), folder));
    const sizes = yield* diskUsage(folder, inside);
    const results = yield* Effect.forEach(inside, (entry, index) =>
      Effect.promise(() =>
        rm(path.resolve(folder, entry), { recursive: true, force: true }).then(
          () => ({ entry, freed: sizes[index] ?? 0, problem: null }),
          (error: unknown) => ({ entry, freed: 0, problem: String(error) }),
        ),
      ),
    );

    return {
      freedBytes: results.reduce((total, { freed }) => total + freed, 0),
      problems: results.flatMap(({ entry, problem }) =>
        problem === null ? [] : [`${entry}: ${problem}`],
      ),
    };
  });

/**
 * Moves a checkout into the machine's trash, with a record of where it came from, if it still
 * matches the inspection the dashboard showed. Caches are deleted from the trashed copy when asked,
 * so a move that fails leaves everything where it was.
 */
export const trashCheckout = Effect.fn("trashCheckout")(
  function* (
    location: CheckoutLocation,
    options: {
      readonly fingerprint: string;
      readonly removeCaches: boolean;
      readonly trash: string;
    },
    output: ActionOutput,
  ) {
    const problem = yield* movableProblem(location);

    if (problem !== null) {
      return problem;
    }

    const ignored = yield* readIgnored(location);

    if ((yield* fingerprintCheckout(location, ignored)) !== options.fingerprint) {
      return skipped(SkipReason.cases.ChangedSinceInspection.make({}));
    }

    const git = yield* readGitStatus(location);
    const id = TrashId.make(randomUUID());
    const item: TrashedCheckout = {
      id,
      originalPath: location.path,
      identity: location.identity,
      directoryName: location.directoryName,
      branch: git.head._tag === "Detached" ? null : git.head.name,
      lastCommit: git.lastCommit,
      trashedAt: yield* DateTime.now,
      sizeBytes: yield* sizeOf(location.path),
    };
    const unprepared = yield* writeTrashItem(options.trash, item);

    if (unprepared !== null) {
      return failed(unprepared);
    }

    const trashed = itemCheckoutPath(options.trash, id);
    const notMoved = unmoved(yield* moveFolder({ from: location.path, to: trashed }), trashed);

    if (notMoved !== null) {
      yield* removeTrashItem(options.trash, id);

      return notMoved;
    }

    output.write(`Moved ${location.path} to the trash\n`);

    if (!options.removeCaches || ignored.caches.length === 0) {
      return succeeded(ActionResult.cases.Trashed.make({ freedBytes: 0 }));
    }

    const removal = yield* removeCaches(trashed, ignored.caches);

    for (const line of removal.problems) {
      output.write(`Couldn't delete a cache folder, ${line}\n`);
    }

    // The record is already saved, so a failure here only leaves its size out of date.
    yield* writeTrashItem(options.trash, { ...item, sizeBytes: yield* sizeOf(trashed) });

    return succeeded(ActionResult.cases.Trashed.make({ freedBytes: removal.freedBytes }));
  },
  Effect.catchTag("CommandFailed", ({ message }) => Effect.succeed(failed(message))),
);

/**
 * Deletes a checkout for good, only if it still matches the inspection the dashboard showed and a
 * fresh inspection, after fetching, finds nothing that exists only here.
 */
export const deleteCheckout = Effect.fn("deleteCheckout")(
  function* (
    location: CheckoutLocation,
    options: InspectionOptions & { readonly fingerprint: string },
    output: ActionOutput,
  ) {
    const problem = yield* movableProblem(location);

    if (problem !== null) {
      return problem;
    }

    const inspection = yield* inspectCheckout(location, options);

    if (inspection.fingerprint !== options.fingerprint) {
      return skipped(SkipReason.cases.ChangedSinceInspection.make({}));
    }

    if (!nothingUnique(inspection)) {
      return skipped(SkipReason.cases.UniqueWork.make({}));
    }

    const removal = yield* Effect.promise(() =>
      rm(location.path, { recursive: true, force: true }).then(
        () => null,
        (error: unknown) => String(error),
      ),
    );

    if (removal !== null) {
      return failed(`Couldn't delete ${location.path}: ${removal}`);
    }

    output.write(`Deleted ${location.path}\n`);

    return succeeded(ActionResult.cases.Deleted.make({}));
  },
  Effect.catchTag("CommandFailed", ({ message }) => Effect.succeed(failed(message))),
);

/** Moves a trashed checkout back to where it was, unless something is there now. */
export const restoreCheckout = Effect.fn("restoreCheckout")(function* (
  trash: string,
  id: TrashId,
  output: ActionOutput,
) {
  const item = yield* readTrashItem(trash, id);

  if (Option.isNone(item)) {
    return skipped(SkipReason.cases.NotInTrash.make({}));
  }

  const destination = item.value.originalPath;
  const notMoved = unmoved(
    yield* moveFolder({ from: itemCheckoutPath(trash, id), to: destination }),
    destination,
  );

  if (notMoved !== null) {
    return notMoved;
  }

  yield* removeTrashItem(trash, id);
  output.write(`Moved ${destination} back from the trash\n`);

  return succeeded(ActionResult.cases.Restored.make({ path: destination }));
});

/** Deletes a trashed checkout for good. */
export const purgeCheckout = Effect.fn("purgeCheckout")(function* (
  trash: string,
  id: TrashId,
  output: ActionOutput,
) {
  const item = yield* readTrashItem(trash, id);

  if (Option.isNone(item)) {
    return skipped(SkipReason.cases.NotInTrash.make({}));
  }

  const problem = yield* removeTrashItem(trash, id);

  if (problem !== null) {
    return failed(problem);
  }

  output.write(`Deleted ${item.value.originalPath} from the trash\n`);

  return succeeded(ActionResult.cases.Purged.make({}));
});
