import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { Effect, Option } from "effect";

import { checkArchiveFolder } from "@fleetfrog/protocol/domain/archiveFolder";
import { expandHome, isWithin } from "@fleetfrog/protocol/domain/cloneDestination";

import { archivedPlacement } from "../archive/archiveRecord.ts";
import { locateCheckout } from "../git/readCheckout.ts";
import { listWorktrees } from "../git/worktrees.ts";

import type { CheckoutLocation } from "../git/readCheckout.ts";

const maximumDepth = 5;
const skippedDirectories = new Set(["node_modules"]);
const gitConcurrency = 8;

export function rootPath(root: string): string {
  return expandHome(root, homedir());
}

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

const linkedWorktreePaths = (directory: string) =>
  listWorktrees(directory).pipe(
    Effect.map((records) =>
      records
        .filter(({ bare, prunable }) => !bare && !prunable)
        .map(({ path: worktree }) => worktree),
    ),
    Effect.orElseSucceed((): ReadonlyArray<string> => []),
  );

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

export const placeLocation = (location: CheckoutLocation, archive: string | null) =>
  archive !== null && isWithin(location.path, archive)
    ? archivedPlacement(location).pipe(Effect.map((placement) => ({ ...location, placement })))
    : Effect.succeed(location);

const locateAll = Effect.fnUntraced(function* (
  candidates: ReadonlyArray<string>,
  archive: string | null,
) {
  const located = yield* Effect.forEach(
    [...new Set(candidates)],
    (candidate) =>
      locateCheckout(candidate).pipe(
        Effect.flatMap((found) =>
          Option.isNone(found)
            ? Effect.succeed(found)
            : placeLocation(found.value, archive).pipe(Effect.asSome),
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

export const repositoryCheckouts = Effect.fn("repositoryCheckouts")(function* (
  main: string,
  archive: string | null,
) {
  return yield* locateAll([main, ...(yield* linkedWorktreePaths(main))], archive);
});

export const discoverCheckouts = Effect.fn("discoverCheckouts")(function* (options: {
  readonly roots: ReadonlyArray<string>;
  readonly archiveFolder: string | null;
  readonly projectFolders: ReadonlyArray<string>;
}) {
  const archive = archivePath(options);

  const underRoots = yield* Effect.promise(() =>
    Promise.all(options.roots.map((root) => findRepositoryDirectories(rootPath(root), archive))),
  );

  const archived =
    archive === null ? [] : yield* Effect.promise(() => findRepositoryDirectories(archive, null));

  const directories = [...underRoots.flat(), ...options.projectFolders, ...archived];

  const worktrees = yield* Effect.forEach(directories, linkedWorktreePaths, {
    concurrency: gitConcurrency,
  });

  return yield* locateAll([...directories, ...worktrees.flat()], archive);
});
