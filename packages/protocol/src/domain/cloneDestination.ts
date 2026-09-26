import type { DiscoveryRoot, Machine, Repository } from "./fleet.ts";

/*
 * Paths here are POSIX paths as macOS and Linux write them. This module also runs in the browser,
 * so it works on strings rather than `node:path`.
 */

/** Expands a leading `~` against the machine's home directory. */
export function expandHome(path: string, home: string): string {
  if (path === "~") {
    return home;
  }

  return path.startsWith("~/") ? `${home.replace(/\/+$/, "")}${path.slice(1)}` : path;
}

function withoutTrailingSlashes(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/** True when `path` is strictly below `folder`. Both must be absolute. */
function isBelow(path: string, folder: string): boolean {
  const prefix = folder === "/" ? "/" : `${folder}/`;

  return path.startsWith(prefix) && path.length > prefix.length;
}

/** True when `path` is `folder` itself or anywhere below it. Both must be absolute. */
export function isWithin(path: string, folder: string): boolean {
  const normalised = withoutTrailingSlashes(folder);

  return path === normalised || isBelow(path, normalised);
}

/** The `~/…` form of a path inside the home directory, or null for a path outside it. */
function homeRelative(path: string, home: string): string | null {
  const normalisedHome = withoutTrailingSlashes(home);

  return isBelow(path, normalisedHome) ? `~${path.slice(normalisedHome.length)}` : null;
}

export type FolderPathCheck =
  | { readonly _tag: "Valid"; readonly path: string }
  | { readonly _tag: "NotAbsolute" }
  /** A hidden folder such as `~/.config`, or one reached through `.` or `..`. */
  | { readonly _tag: "Hidden" };

/**
 * Checks a folder path that needs no file system: an absolute or `~` path with no hidden, `.` or
 * `..` segments. Returns it expanded, without trailing slashes.
 */
export function checkFolderPath(options: {
  readonly path: string;
  readonly home: string;
}): FolderPathCheck {
  const path = withoutTrailingSlashes(expandHome(options.path.trim(), options.home));

  if (!path.startsWith("/")) {
    return { _tag: "NotAbsolute" };
  }

  // An empty segment from `//` would make the path compare unlike the folder it is in.
  return path
    .split("/")
    .slice(1)
    .some((segment) => segment === "" || segment.startsWith("."))
    ? { _tag: "Hidden" }
    : { _tag: "Valid", path };
}

export type DestinationCheck =
  | { readonly _tag: "Valid"; readonly path: string; readonly root: string }
  | { readonly _tag: "NotAbsolute" }
  /** A hidden folder such as `~/.config`, where a clone could plant configuration. */
  | { readonly _tag: "Hidden" }
  | { readonly _tag: "OutsideRoots" };

/**
 * Checks the parts of a clone destination that need no file system. The destination must be an
 * absolute or `~` path, with no hidden, `.` or `..` segments anywhere, strictly inside one of the
 * machine's discovery folders. The agent repeats this and also checks the disk.
 */
export function checkCloneDestination(options: {
  readonly destination: string;
  readonly home: string;
  readonly roots: ReadonlyArray<string>;
}): DestinationCheck {
  const folder = checkFolderPath({ path: options.destination, home: options.home });

  if (folder._tag !== "Valid") {
    return folder;
  }

  const { path } = folder;
  const root = options.roots.find((candidate) =>
    isBelow(path, withoutTrailingSlashes(expandHome(candidate, options.home))),
  );

  return root === undefined ? { _tag: "OutsideRoots" } : { _tag: "Valid", path, root };
}

function mostCommon(values: ReadonlyArray<string>): string | undefined {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts].toSorted(([, left], [, right]) => right - left)[0]?.[0];
}

/** The URL a clone of the repository comes from: the origin most of its checkouts share. */
export function cloneSource(repository: Pick<Repository, "checkouts">): string | undefined {
  return mostCommon(
    repository.checkouts.flatMap(({ checkout }) =>
      checkout.originUrl === null ? [] : [checkout.originUrl],
    ),
  );
}

/**
 * Where to clone a repository onto `target`: the path other machines keep it at, relative to home,
 * when that lies in one of the target's discovery folders and nothing is there yet. Otherwise the
 * default folder, which is the first. Null when the target has no discovery folders.
 */
export function suggestCloneDestination(options: {
  readonly repository: Repository;
  readonly target: Machine;
  readonly machines: ReadonlyArray<Machine>;
  /** Absolute paths of checkouts already on the target. */
  readonly occupied: ReadonlySet<string>;
}): { readonly destination: string; readonly root: DiscoveryRoot } | null {
  const { repository, target } = options;
  const roots = target.discoveryRoots;
  const homes = new Map(options.machines.map(({ id, info }) => [id, info.homeDirectory]));
  const mirrored = mostCommon(
    repository.checkouts.flatMap(({ machineId, checkout }) => {
      const home = homes.get(machineId);
      const relative =
        machineId === target.id || checkout.worktree._tag !== "Main" || home === undefined
          ? null
          : homeRelative(checkout.path, home);

      return relative === null ? [] : [relative];
    }),
  );

  const rootOf = (destination: string) => {
    const check = checkCloneDestination({
      destination,
      home: target.info.homeDirectory,
      roots: roots.map(({ path }) => path),
    });

    return check._tag === "Valid" && !options.occupied.has(check.path)
      ? roots.find(({ path }) => path === check.root)
      : undefined;
  };

  const mirroredRoot = mirrored === undefined ? undefined : rootOf(mirrored);

  if (mirrored !== undefined && mirroredRoot !== undefined) {
    return { destination: mirrored, root: mirroredRoot };
  }

  const [defaultRoot] = roots;

  return defaultRoot === undefined
    ? null
    : {
        destination: `${withoutTrailingSlashes(defaultRoot.path)}/${repository.name}`,
        root: defaultRoot,
      };
}
