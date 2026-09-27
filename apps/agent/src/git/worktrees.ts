import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { Effect } from "effect";

import { runGit } from "../process/runTool.ts";

import type { LinkedWorktree } from "@fleetfrog/protocol/domain/checkout";

import type { CheckoutLocation } from "./readCheckout.ts";

/** One record of `git worktree list --porcelain`. The first is always the main worktree. */
export interface WorktreeRecord {
  readonly path: string;
  /** The checked-out branch, or null when HEAD is detached. */
  readonly branch: string | null;
  /** Git has noticed the folder is gone. */
  readonly prunable: boolean;
  readonly bare: boolean;
}

/** Parses `git worktree list --porcelain`, whose records are separated by blank lines. */
export function parseWorktreeList(output: string): ReadonlyArray<WorktreeRecord> {
  return output
    .split("\n\n")
    .map((record) => record.split("\n"))
    .flatMap((lines) => {
      const worktree = lines.find((line) => line.startsWith("worktree "));
      const branch = lines.find((line) => line.startsWith("branch refs/heads/"));

      return worktree === undefined
        ? []
        : [
            {
              path: worktree.slice("worktree ".length),
              branch: branch === undefined ? null : branch.slice("branch refs/heads/".length),
              prunable: lines.some((line) => line.startsWith("prunable")),
              bare: lines.includes("bare"),
            },
          ];
    });
}

/** Every worktree of the repository at `directory`, the main one first. */
export const listWorktrees = (directory: string) =>
  runGit(directory, ["worktree", "list", "--porcelain"]).pipe(Effect.map(parseWorktreeList));

/**
 * Whether the worktree's `.git` file still leads to this repository. It stops doing so when the
 * main checkout moves, since Git records the path.
 */
async function linksBack(worktree: string, commonDirectory: string): Promise<boolean> {
  try {
    const link = (await readFile(path.join(worktree, ".git"), "utf8")).trim();

    if (!link.startsWith("gitdir: ")) {
      return false;
    }

    const [target, common] = await Promise.all([
      realpath(link.slice("gitdir: ".length)),
      realpath(commonDirectory),
    ]);

    return target.startsWith(path.join(common, "worktrees") + path.sep);
  } catch {
    return false;
  }
}

/** The clone's linked worktrees, each with whether its folder is there and still linked. */
export const readLinkedWorktrees = Effect.fn("readLinkedWorktrees")(function* (
  location: CheckoutLocation,
) {
  const [, ...linked] = yield* listWorktrees(location.path);

  return yield* Effect.promise(() =>
    Promise.all(
      linked.map(async ({ path: worktree, branch, prunable }): Promise<LinkedWorktree> => {
        if (prunable) {
          return { path: worktree, branch, state: "Missing" };
        }

        return {
          path: worktree,
          branch,
          state: (await linksBack(worktree, location.commonDirectory)) ? "Present" : "Broken",
        };
      }),
    ),
  );
});

/** Linked worktrees whose folders still exist, which moving the clone would break. */
export const countLinkedWorktrees = (location: CheckoutLocation) =>
  readLinkedWorktrees(location).pipe(
    Effect.map((worktrees) => worktrees.filter(({ state }) => state !== "Missing").length),
  );
