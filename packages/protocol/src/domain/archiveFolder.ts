import { checkFolderPath, expandHome, isWithin } from "./cloneDestination.ts";

import type { FolderPathCheck } from "./cloneDestination.ts";

export type ArchiveFolderCheck =
  | Exclude<FolderPathCheck, { _tag: "Valid" }>
  | { readonly _tag: "Valid"; readonly path: string }
  | { readonly _tag: "ContainsProjectFolder"; readonly root: string };

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

export function archiveDestination(options: {
  readonly path: string;
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

export function unarchiveDestination(options: {
  readonly path: string;
  readonly originalPath: string | null;
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
