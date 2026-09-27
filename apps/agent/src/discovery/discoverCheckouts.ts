import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { Effect, Option } from "effect";

import { checkArchiveFolder } from "@fleetfrog/protocol/domain/archiveFolder";
import { expandHome, isWithin } from "@fleetfrog/protocol/domain/cloneDestination";

import { archivedPlacement } from "../archive/archiveRecord.ts";
import { locateCheckout } from "../git/readCheckout.ts";
import { runGit } from "../process/runTool.ts";

import type { CheckoutLocation } from "../git/readCheckout.ts";

const maximumDepth = 5;
const skippedDirectories = new Set(["node_modules"]);
const gitConcurrency = 8;

/** A discovery folder as a path on this machine. */
export function rootPath(root: string): string {
  return expandHome(root, homedir());
}

/**
 * Directories under `root` that contain a `.git` entry, without descending into repositories or
 * into `skipped`, such as an Archive folder inside a project folder.
 */
async function findRepositoryDirectories(
  root: string,
  skipped: string | null,
): Promise<Array<string>> {
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
      const directory = path.join(next.directory, entry.name);

      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        !skippedDirectories.has(entry.name) &&
        directory !== skipped
      ) {
        pending.push({ directory, depth: next.depth + 1 });
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

/**
 * The Archive folder as a path on this machine, or null when none is set or it can't be one here
 * because it holds a project folder.
 */
export function archivePath(options: {
  readonly archiveFolder: string | null;
  readonly roots: ReadonlyArray<string>;
}): string | null {
  if (options.archiveFolder === null) {
    return null;
  }

  const checked = checkArchiveFolder({
    folder: options.archiveFolder,
    home: homedir(),
    roots: options.roots,
  });

  return checked._tag === "Valid" ? checked.path : null;
}

/** The location with its placement: archived when it's inside the Archive folder. */
export const placeLocation = (location: CheckoutLocation, archive: string | null) =>
  archive !== null && isWithin(location.path, archive)
    ? archivedPlacement(location).pipe(Effect.map((placement) => ({ ...location, placement })))
    : Effect.succeed(location);

/**
 * Finds every checkout under the discovery roots, plus linked worktrees stored elsewhere, and every
 * checkout in the Archive folder. The Archive folder is left out of the discovery roots it's in.
 */
export const discoverCheckouts = Effect.fn("discoverCheckouts")(function* (options: {
  readonly roots: ReadonlyArray<string>;
  readonly archiveFolder: string | null;
}) {
  const archive = archivePath(options);
  const directories = yield* Effect.promise(() =>
    Promise.all(options.roots.map((root) => findRepositoryDirectories(rootPath(root), archive))),
  );
  const archived =
    archive === null ? [] : yield* Effect.promise(() => findRepositoryDirectories(archive, null));
  const worktrees = yield* Effect.forEach(directories.flat(), listWorktrees, {
    concurrency: gitConcurrency,
  });
  const candidates = [...new Set([...directories.flat(), ...worktrees.flat(), ...archived])];
  const located = yield* Effect.forEach(
    candidates,
    (candidate) =>
      locateCheckout(candidate).pipe(
        Effect.flatMap((found) =>
          Option.isNone(found)
            ? Effect.succeed(found)
            : placeLocation(found.value, archive).pipe(Effect.map(Option.some)),
        ),
      ),
    { concurrency: gitConcurrency },
  );
  const byPath = new Map<string, CheckoutLocation>();

  for (const location of located) {
    if (Option.isSome(location)) {
      byPath.set(location.value.path, location.value);
    }
  }

  return [...byPath.values()];
});
