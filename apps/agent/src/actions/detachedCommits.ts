import { DateTime, Effect } from "effect";

import { deletedBranchPrefix } from "@fleetfrog/protocol/domain/checkout";

import { runGit, runGitAction } from "../process/runTool.ts";

import type { ActionOutput } from "./actionOutput.ts";

/** How many commits HEAD in the worktree at `directory` holds that no branch, tag or remote has. */
export const countDetachedCommits = (directory: string) =>
  runGit(directory, [
    "rev-list",
    "--count",
    "HEAD",
    "--not",
    "--branches",
    "--tags",
    "--remotes",
    "--glob=refs/fleetfrog/*",
  ]).pipe(Effect.map((output) => Number(output.trim())));

/**
 * Keeps the commits only a detached HEAD holds as a deleted branch named after its commit, such
 * as `detached-1a2b3c4`, so they appear in the trash and can be restored as that branch. Returns
 * how many commits it kept, which is 0 when every commit is on a ref already.
 */
export const keepDetachedCommits = Effect.fn("keepDetachedCommits")(function* (
  directory: string,
  output: ActionOutput,
) {
  const commits = yield* countDetachedCommits(directory);

  if (commits === 0) {
    return 0;
  }

  const sha = (yield* runGit(directory, ["rev-parse", "--verify", "HEAD"])).trim();
  const keptAt = DateTime.toEpochMillis(yield* DateTime.now);

  yield* runGitAction({
    cwd: directory,
    args: ["update-ref", `${deletedBranchPrefix}${keptAt}/detached-${sha.slice(0, 7)}`, sha, ""],
    onOutput: output.write,
  });

  return commits;
});
