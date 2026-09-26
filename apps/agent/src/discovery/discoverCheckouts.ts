import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { Effect, Option } from "effect";

import { locateCheckout } from "../git/readCheckout.ts";
import { runGit } from "../process/runTool.ts";

import type { CheckoutLocation } from "../git/readCheckout.ts";

const maximumDepth = 5;
const skippedDirectories = new Set(["node_modules"]);
const gitConcurrency = 8;

export function expandHome(root: string): string {
  return root === "~" || root.startsWith("~/") ? path.join(homedir(), root.slice(1)) : root;
}

/** Directories under `root` that contain a `.git` entry, without descending into repositories. */
async function findRepositoryDirectories(root: string): Promise<Array<string>> {
  const found: Array<string> = [];
  const pending: Array<{ readonly directory: string; readonly depth: number }> = [
    { directory: root, depth: 0 },
  ];

  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    let entries;

    try {
      entries = await readdir(next.directory, { withFileTypes: true });
    } catch {
      // Missing roots and unreadable directories contribute nothing.
      continue;
    }

    if (entries.some((entry) => entry.name === ".git")) {
      found.push(next.directory);
      continue;
    }

    if (next.depth === maximumDepth) {
      continue;
    }

    for (const entry of entries) {
      // Symbolic links are skipped so a link back up the tree cannot loop.
      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        !skippedDirectories.has(entry.name)
      ) {
        pending.push({ directory: path.join(next.directory, entry.name), depth: next.depth + 1 });
      }
    }
  }

  return found;
}

/** Linked worktrees of the repository at `directory`, wherever they live. */
const listWorktrees = Effect.fn("listWorktrees")(function* (directory: string) {
  const output = yield* runGit(directory, ["worktree", "list", "--porcelain"]).pipe(
    Effect.orElseSucceed(() => ""),
  );

  // Records are blank-line separated; bare and prunable entries have no usable working tree.
  return output
    .split("\n\n")
    .map((record) => record.split("\n"))
    .filter((lines) => !lines.some((line) => line === "bare" || line.startsWith("prunable")))
    .flatMap((lines) => lines.filter((line) => line.startsWith("worktree ")))
    .map((line) => line.slice("worktree ".length));
});

/** Finds every checkout under the discovery roots, plus linked worktrees stored elsewhere. */
export const discoverCheckouts = Effect.fn("discoverCheckouts")(function* (
  roots: ReadonlyArray<string>,
) {
  const directories = yield* Effect.promise(() =>
    Promise.all(roots.map((root) => findRepositoryDirectories(expandHome(root)))),
  );
  const worktrees = yield* Effect.forEach(directories.flat(), listWorktrees, {
    concurrency: gitConcurrency,
  });
  const candidates = [...new Set([...directories.flat(), ...worktrees.flat()])];
  const located = yield* Effect.forEach(candidates, locateCheckout, {
    concurrency: gitConcurrency,
  });
  const byPath = new Map<string, CheckoutLocation>();

  for (const location of located) {
    if (Option.isSome(location)) {
      byPath.set(location.value.path, location.value);
    }
  }

  return [...byPath.values()];
});
