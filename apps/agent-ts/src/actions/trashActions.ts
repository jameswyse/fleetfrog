import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";

import { DateTime, Effect, Option } from "effect";

import { ActionResult, SkipReason } from "@fleetfrog/protocol/domain/action";
import { isWithin } from "@fleetfrog/protocol/domain/cloneDestination";
import { nothingUnique, TrashId } from "@fleetfrog/protocol/domain/trash";

import { readGitStatus } from "../git/readCheckout.ts";
import { readLinkedWorktrees } from "../git/worktrees.ts";
import { fingerprintCheckout, inspectCheckout, readIgnored } from "../inspect/inspectCheckout.ts";
import { diskUsage } from "../process/diskUsage.ts";
import { runGitAction } from "../process/runTool.ts";
import {
  forgetTrashItem,
  itemCheckoutPath,
  itemWorktreePath,
  readTrashItem,
  removeTrashItem,
  writeTrashItem,
} from "../trash/trashFolder.ts";
import { performCheckoutMove, planCheckoutMove } from "./checkoutMove.ts";
import { movableProblem, worktreesProblem } from "./movableCheckout.ts";
import { failed, failedWith, skipped, succeeded } from "./outcomes.ts";

import type { TrashedCheckout } from "@fleetfrog/protocol/domain/trash";

import type { CheckoutLocation } from "../git/readCheckout.ts";
import type { InspectionOptions } from "../inspect/inspectCheckout.ts";
import type { ActionOutput } from "./actionOutput.ts";

const sizeOf = (folder: string) =>
  diskUsage(path.dirname(folder), [path.basename(folder)]).pipe(Effect.map(([bytes = 0]) => bytes));

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
    const problem = movableProblem(location);

    if (problem !== null) {
      return problem;
    }

    const ignored = yield* readIgnored(location);

    if ((yield* fingerprintCheckout(location, ignored)) !== options.fingerprint) {
      return skipped(SkipReason.cases.ChangedSinceInspection.make({}));
    }

    const git = yield* readGitStatus(location);
    const id = TrashId.make(randomUUID());
    let worktreeCount = 0;

    const planned = yield* planCheckoutMove({
      location,
      destination: itemCheckoutPath(options.trash, id),
      worktreeDestination: (worktree) => {
        worktreeCount += 1;

        return itemWorktreePath(options.trash, id, `${worktreeCount}-${path.basename(worktree)}`);
      },
      whenTaken: "Refuse",
    });

    if (planned._tag === "Refused") {
      return planned.outcome;
    }

    const item: TrashedCheckout = {
      id,
      originalPath: location.path,
      identity: location.identity,
      directoryName: location.directoryName,
      branch: git.head._tag === "Detached" ? null : git.head.name,
      lastCommit: git.lastCommit,
      trashedAt: yield* DateTime.now,
      sizeBytes: yield* sizeOf(location.path),
      worktrees: planned.move.separate.map(({ from, to }) => ({
        originalPath: from,
        trashedPath: to,
      })),
    };

    const unprepared = yield* writeTrashItem(options.trash, item);

    if (unprepared !== null) {
      return failed(unprepared);
    }

    const result = yield* performCheckoutMove(planned.move, output);

    if (result._tag === "NotMoved") {
      yield* removeTrashItem(options.trash, id);

      return result.outcome;
    }

    const trashed = planned.move.main.to;

    const removal =
      options.removeCaches && ignored.caches.length > 0
        ? yield* removeCaches(trashed, ignored.caches)
        : { freedBytes: 0, problems: [] };

    for (const line of removal.problems) {
      output.write(`Couldn't delete a cache folder, ${line}\n`);
    }

    yield* writeTrashItem(options.trash, {
      ...item,
      sizeBytes: yield* sizeOf(trashed),
      worktrees: result.worktrees.map(({ from, to }) => ({ originalPath: from, trashedPath: to })),
    });

    return succeeded(ActionResult.cases.Trashed.make({ freedBytes: removal.freedBytes }));
  },
  Effect.catchTag("CommandFailed", failedWith),
);

export const deleteCheckout = Effect.fn("deleteCheckout")(
  function* (
    location: CheckoutLocation,
    options: InspectionOptions & {
      readonly fingerprint: string;
      readonly discardUniqueWork: boolean;
    },
    output: ActionOutput,
  ) {
    const problem =
      movableProblem(location) ??
      (options.discardUniqueWork ? null : yield* worktreesProblem(location));

    if (problem !== null) {
      return problem;
    }

    if (options.discardUniqueWork) {
      const fingerprint = yield* fingerprintCheckout(location, yield* readIgnored(location));

      if (fingerprint !== options.fingerprint) {
        return skipped(SkipReason.cases.ChangedSinceInspection.make({}));
      }
    } else {
      const inspection = yield* inspectCheckout(location, options);

      if (inspection.fingerprint !== options.fingerprint) {
        return skipped(SkipReason.cases.ChangedSinceInspection.make({}));
      }

      if (!nothingUnique(inspection)) {
        return skipped(SkipReason.cases.UniqueWork.make({}));
      }
    }

    for (const worktree of yield* readLinkedWorktrees(location)) {
      if (worktree.state === "Broken") {
        yield* runGitAction({
          cwd: location.path,
          args: ["worktree", "repair", worktree.path],
          onOutput: output.write,
        });
      }

      yield* runGitAction({
        cwd: location.path,
        args: ["worktree", "remove", "--force", "--force", worktree.path],
        onOutput: output.write,
      });
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
  Effect.catchTag("CommandFailed", failedWith),
);

export const restoreCheckout = Effect.fn("restoreCheckout")(
  function* (trash: string, id: TrashId, output: ActionOutput) {
    const item = yield* readTrashItem(trash, id);

    if (Option.isNone(item)) {
      return skipped(SkipReason.cases.NotInTrash.make({}));
    }

    const trashed = itemCheckoutPath(trash, id);

    const returning = new Map(
      item.value.worktrees.map(({ originalPath, trashedPath }) => [trashedPath, originalPath]),
    );

    const planned = yield* planCheckoutMove({
      location: { path: trashed, commonDirectory: path.join(trashed, ".git") },
      destination: item.value.originalPath,
      worktreeDestination: (worktree) => returning.get(worktree) ?? null,
      whenTaken: "Number",
    });

    if (planned._tag === "Refused") {
      return planned.outcome;
    }

    const result = yield* performCheckoutMove(planned.move, output);

    if (result._tag === "NotMoved") {
      return result.outcome;
    }

    yield* forgetTrashItem(trash, id);

    return succeeded(
      ActionResult.cases.Restored.make({ path: planned.move.main.to, branch: null }),
    );
  },
  Effect.catchTag("CommandFailed", failedWith),
);

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
