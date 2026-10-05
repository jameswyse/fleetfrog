import { DateTime, Effect } from "effect";

import { droppedStashPrefix } from "@fleetfrog/protocol/domain/checkout";

import { runGit, runGitAction } from "../process/runTool.ts";

import type { ActionOutput } from "./actionOutput.ts";

export const nothingDiscarded =
  "Git found no changes it could stash, so nothing was discarded. Changes inside a submodule have to be discarded in the submodule.";

export const stashTip = Effect.fn("stashTip")(function* (cwd: string) {
  const sha = (yield* runGit(cwd, ["stash", "list", "-1", "--format=%H"])).trim();

  return sha === "" ? null : sha;
});

export const trashNewStash = Effect.fn("trashNewStash")(function* (
  cwd: string,
  before: string | null,
  output: ActionOutput,
) {
  const sha = yield* stashTip(cwd);

  if (sha === null || sha === before) {
    return false;
  }

  const droppedAt = DateTime.toEpochMillis(yield* DateTime.now);

  yield* runGitAction({
    cwd,
    args: ["update-ref", `${droppedStashPrefix}${droppedAt}/0`, sha, ""],
    onOutput: output.write,
  });
  yield* runGitAction({
    cwd,
    args: ["stash", "drop", "--quiet", "stash@{0}"],
    onOutput: output.write,
  });

  return true;
});

export function fileCounts(options: {
  readonly files: number;
  readonly discardChanges: boolean;
  readonly discarded: boolean;
}) {
  if (!options.discardChanges) {
    return { stashedFiles: options.files, discardedFiles: 0 };
  }

  return { stashedFiles: 0, discardedFiles: options.discarded ? options.files : 0 };
}
