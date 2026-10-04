import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { Effect } from "effect";

import { runGit } from "../process/runTool.ts";

import type { LinkedWorktree } from "@fleetfrog/protocol/domain/checkout";

import type { CheckoutLocation } from "./readCheckout.ts";

export interface WorktreeRecord {
  readonly path: string;
  readonly branch: string | null;
  readonly prunable: boolean;
  readonly locked: string | null;
  readonly bare: boolean;
}

export function parseWorktreeList(output: string): ReadonlyArray<WorktreeRecord> {
  return output
    .split("\n\n")
    .map((record) => record.split("\n"))
    .flatMap((lines) => {
      const worktree = lines.find((line) => line.startsWith("worktree "));
      const branch = lines.find((line) => line.startsWith("branch refs/heads/"));
      const locked = lines.find((line) => line === "locked" || line.startsWith("locked "));

      return worktree === undefined
        ? []
        : [
            {
              path: worktree.slice("worktree ".length),
              branch: branch === undefined ? null : branch.slice("branch refs/heads/".length),
              prunable: lines.some((line) => line.startsWith("prunable")),
              locked: locked === undefined ? null : locked.slice("locked".length).trim(),
              bare: lines.includes("bare"),
            },
          ];
    });
}

export const listWorktrees = (directory: string) =>
  runGit(directory, ["worktree", "list", "--porcelain"]).pipe(Effect.map(parseWorktreeList));

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

export const readLinkedWorktrees = Effect.fn("readLinkedWorktrees")(function* (
  location: Pick<CheckoutLocation, "path" | "commonDirectory">,
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

export const countLinkedWorktrees = (location: CheckoutLocation) =>
  readLinkedWorktrees(location).pipe(
    Effect.map((worktrees) => worktrees.filter(({ state }) => state !== "Missing").length),
  );
