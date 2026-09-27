import { checkFolderPath, expandHome, isWithin } from "./cloneDestination.ts";

import type { FolderPathCheck } from "./cloneDestination.ts";

/*
 * Paths here are POSIX paths as macOS and Linux write them. This module also runs in the browser,
 * so it works on strings rather than `node:path`.
 */

export type ArchiveFolderCheck =
  | Exclude<FolderPathCheck, { _tag: "Valid" }>
  | { readonly _tag: "Valid"; readonly path: string }
  /** The archive would hold a project folder, which discovery would then stop searching. */
  | { readonly _tag: "ContainsProjectFolder"; readonly root: string };

/**
 * Checks the Archive folder against one machine: an absolute or `~` path with no hidden segments,
 * so it stays visible in file managers, that is neither a project folder nor contains one. It may
 * sit inside a project folder, which discovery then skips. Returns it expanded.
 */
export function checkArchiveFolder(options: {
  readonly folder: string;
  readonly home: string;
  readonly roots: ReadonlyArray<string>;
}): ArchiveFolderCheck {
  const folder = checkFolderPath({ path: options.folder, home: options.home });

  if (folder._tag !== "Valid") {
    return folder;
  }

  const root = options.roots.find((candidate) =>
    isWithin(expandHome(candidate, options.home), folder.path),
  );

  return root === undefined ? folder : { _tag: "ContainsProjectFolder", root };
}

/**
 * Where archiving the checkout at `path` moves it: the same path below the Archive folder as it
 * has below its project folder, or its folder name when it's in none of them.
 */
export function archiveDestination(options: {
  readonly path: string;
  /** The expanded Archive folder. */
  readonly archive: string;
  readonly home: string;
  readonly roots: ReadonlyArray<string>;
}): string {
  const root = options.roots
    .map((candidate) => expandHome(candidate, options.home).replace(/\/+$/, ""))
    .find((candidate) => isWithin(options.path, candidate) && options.path !== candidate);
  const relative =
    root === undefined
      ? (options.path.split("/").findLast((part) => part !== "") ?? "")
      : options.path.slice(root.length + 1);

  return `${options.archive.replace(/\/+$/, "")}/${relative}`;
}

/**
 * Where unarchiving the checkout at `path` moves it: back where it was archived from when that is
 * still inside a project folder, or else the same path below the first project folder as it has
 * below the Archive folder. Null when the machine has no project folders.
 */
export function unarchiveDestination(options: {
  readonly path: string;
  readonly originalPath: string | null;
  /** The expanded Archive folder. */
  readonly archive: string;
  readonly home: string;
  readonly roots: ReadonlyArray<string>;
}): string | null {
  const roots = options.roots.map((root) => expandHome(root, options.home).replace(/\/+$/, ""));
  const { originalPath } = options;

  if (
    originalPath !== null &&
    roots.some((root) => isWithin(originalPath, root) && originalPath !== root)
  ) {
    return originalPath;
  }

  const [first] = roots;
  const archive = options.archive.replace(/\/+$/, "");

  if (first === undefined) {
    return null;
  }

  const relative = isWithin(options.path, archive)
    ? options.path.slice(archive.length + 1)
    : (options.path.split("/").findLast((part) => part !== "") ?? "");

  return `${first}/${relative}`;
}
