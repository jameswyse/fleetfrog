import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";

import { DateTime, Effect, Option } from "effect";

import { ActionOutcome, ActionResult, SkipReason } from "@fleetfrog/protocol/domain/action";
import { isWithin } from "@fleetfrog/protocol/domain/cloneDestination";
import { nothingUnique, TrashId } from "@fleetfrog/protocol/domain/trash";

import { readGitStatus } from "../git/readCheckout.ts";
import {
  countLinkedWorktrees,
  fingerprintCheckout,
  inspectCheckout,
  readIgnored,
} from "../inspect/inspectCheckout.ts";
import { diskUsage } from "../process/diskUsage.ts";
import {
  itemCheckoutPath,
  readTrashItem,
  removeTrashItem,
  writeTrashItem,
} from "../trash/trashFolder.ts";
import { moveFolder, unmoved } from "./archiveActions.ts";

import type { CheckoutLocation } from "../git/readCheckout.ts";
import type { ActionOutput } from "./actionOutput.ts";

const failed = (message: string) => ActionOutcome.cases.Failed.make({ message });
const skipped = (reason: SkipReason) => ActionOutcome.cases.Skipped.make({ reason });
const succeeded = (result: ActionResult) => ActionOutcome.cases.Succeeded.make({ result });

/**
 * Why the checkout can't leave its place as a whole, or null when it can: only a main checkout
 * whose Git directory is inside it, without linked worktrees that would be left broken.
 */
const movableProblem = (location: CheckoutLocation) =>
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

/** Deletes cache folders inside the checkout, returning the bytes they took up. */
const removeCaches = (location: CheckoutLocation, caches: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const inside = caches.filter((entry) =>
      isWithin(path.resolve(location.path, entry), location.path),
    );
    const sizes = yield* diskUsage(location.path, inside);

    // `rm` removes a symbolic link itself, never what it points at.
    yield* Effect.promise(() =>
      Promise.all(
        inside.map((entry) =>
          rm(path.resolve(location.path, entry), { recursive: true, force: true }),
        ),
      ),
    );

    return sizes.reduce((total, size) => total + size, 0);
  });

/**
 * Moves a checkout into the machine's trash, with a record of where it came from, if it still
 * matches the inspection the dashboard showed. Caches are deleted first when asked, since they can
 * be rebuilt.
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

    if ((yield* fingerprintCheckout(location, ignored.other)) !== options.fingerprint) {
      return skipped(SkipReason.cases.ChangedSinceInspection.make({}));
    }

    const git = yield* readGitStatus(location);
    const freedBytes = options.removeCaches ? yield* removeCaches(location, ignored.caches) : 0;

    if (freedBytes > 0) {
      output.write(`Removed ${ignored.caches.length} cache folders\n`);
    }

    const [sizeBytes = 0] = yield* diskUsage(path.dirname(location.path), [
      path.basename(location.path),
    ]);
    const id = TrashId.make(randomUUID());
    const unprepared = yield* writeTrashItem(options.trash, {
      id,
      originalPath: location.path,
      identity: location.identity,
      directoryName: location.directoryName,
      branch: git.head._tag === "Detached" ? null : git.head.name,
      lastCommit: git.lastCommit,
      trashedAt: yield* DateTime.now,
      sizeBytes,
    });

    if (unprepared !== null) {
      return failed(unprepared);
    }

    const destination = itemCheckoutPath(options.trash, id);
    const notMoved = unmoved(yield* moveFolder(location.path, destination), destination);

    if (notMoved !== null) {
      yield* removeTrashItem(options.trash, id);

      return notMoved;
    }

    output.write(`Moved ${location.path} to the trash\n`);

    return succeeded(ActionResult.cases.Trashed.make({ freedBytes }));
  },
  Effect.catchTag("CommandFailed", ({ message }) => Effect.succeed(failed(message))),
);

/**
 * Deletes a checkout for good, only if it still matches the inspection the dashboard showed and a
 * fresh inspection, after fetching, finds nothing that exists only here.
 */
export const deleteCheckout = Effect.fn("deleteCheckout")(
  function* (location: CheckoutLocation, fingerprint: string, output: ActionOutput) {
    const problem = yield* movableProblem(location);

    if (problem !== null) {
      return problem;
    }

    const inspection = yield* inspectCheckout(location);

    if (inspection.fingerprint !== fingerprint) {
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
    yield* moveFolder(itemCheckoutPath(trash, id), destination),
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
