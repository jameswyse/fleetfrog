import { DateTime, Effect } from "effect";

import { deletedBranchPrefix } from "@fleetfrog/protocol/domain/checkout";

import { runGit, runGitAction } from "../process/runTool.ts";

import type { ActionOutput } from "./actionOutput.ts";

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
