import { DateTime, Effect } from "effect";

import { ActionResult, SkipReason } from "@fleetfrog/protocol/domain/action";
import { droppedStashPrefix, parseDroppedStashRef } from "@fleetfrog/protocol/domain/checkout";

import { runGit, runGitAction } from "../process/runTool.ts";
import { refCommit } from "./gitActions.ts";
import { failedWith, skipped, succeeded } from "./outcomes.ts";

import type { CheckoutLocation } from "../git/readCheckout.ts";
import type { ActionOutput } from "./actionOutput.ts";

/** The commit each stash is, by index, newest first as `git stash list` numbers them. */
const stashCommits = (location: CheckoutLocation) =>
  runGit(location.path, ["stash", "list", "--format=%H"]).pipe(
    Effect.map((output) => output.split("\n").filter((sha) => sha !== "")),
  );

/**
 * Moves stashes to the trash: each is kept as `refs/fleetfrog/stashes/<time>/<index>`, with the
 * index the dashboard showed, then dropped from the stash list. Each is found by its commit just
 * before it goes, since dropping one renumbers the ones after it, and a stash that's gone already
 * is left out. Keeping it first means a stop partway leaves no copy of a stash that wasn't dropped.
 */
export const dropStashes = Effect.fn("dropStashes")(
  function* (
    location: CheckoutLocation,
    stashes: ReadonlyArray<{ readonly index: number; readonly sha: string }>,
    output: ActionOutput,
  ) {
    const droppedAt = DateTime.toEpochMillis(yield* DateTime.now);
    let dropped = 0;

    for (const { index, sha } of stashes) {
      const current = (yield* stashCommits(location)).indexOf(sha);

      if (current !== -1) {
        yield* runGitAction({
          cwd: location.path,
          args: ["update-ref", `${droppedStashPrefix}${droppedAt}/${index}`, sha, ""],
          onOutput: output.write,
        });
        yield* runGitAction({
          cwd: location.path,
          args: ["stash", "drop", "--quiet", `stash@{${current}}`],
          onOutput: output.write,
        });
        dropped += 1;
      }
    }

    return dropped === 0
      ? skipped(SkipReason.cases.NoSuchStash.make({}))
      : succeeded(
          ActionResult.cases.StashesDropped.make({
            stashes: dropped,
            missing: stashes.length - dropped,
          }),
        );
  },
  Effect.catchTag("CommandFailed", failedWith),
);

/** The commit a dropped-stash ref keeps, or null when it isn't one or is gone. */
const droppedStashCommit = (location: CheckoutLocation, ref: string) =>
  parseDroppedStashRef(ref) === null ? Effect.succeed(null) : refCommit(location, ref);

/** Puts a dropped stash back at the top of the stash list, with its message. */
export const restoreStash = Effect.fn("restoreStash")(
  function* (location: CheckoutLocation, ref: string, output: ActionOutput) {
    const sha = yield* droppedStashCommit(location, ref);

    if (sha === null) {
      return skipped(SkipReason.cases.NotInTrash.make({}));
    }

    const message = (yield* runGit(location.path, ["log", "-1", "--format=%s", sha])).trim();

    yield* runGitAction({
      cwd: location.path,
      args: ["stash", "store", "--message", message, sha],
      onOutput: output.write,
    });
    yield* runGitAction({
      cwd: location.path,
      args: ["update-ref", "-d", ref, sha],
      onOutput: output.write,
    });

    return succeeded(ActionResult.cases.Restored.make({ path: null, branch: null }));
  },
  Effect.catchTag("CommandFailed", failedWith),
);

/** Forgets a dropped stash. Its commits go once Git's garbage collection finds them unreachable. */
export const purgeStash = Effect.fn("purgeStash")(
  function* (location: CheckoutLocation, ref: string, output: ActionOutput) {
    const sha = yield* droppedStashCommit(location, ref);

    if (sha === null) {
      return skipped(SkipReason.cases.NotInTrash.make({}));
    }

    yield* runGitAction({
      cwd: location.path,
      args: ["update-ref", "-d", ref, sha],
      onOutput: output.write,
    });

    return succeeded(ActionResult.cases.Purged.make({}));
  },
  Effect.catchTag("CommandFailed", failedWith),
);
