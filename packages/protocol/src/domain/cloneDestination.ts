import type { DiscoveryRoot, Machine, Repository } from "./fleet.ts";

export function expandHome(path: string, home: string): string {
  if (path === "~") {
    return home;
  }

  return path.startsWith("~/") ? `${home.replace(/\/+$/, "")}${path.slice(1)}` : path;
}

function withoutTrailingSlashes(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function isBelow(path: string, folder: string): boolean {
  const prefix = folder === "/" ? "/" : `${folder}/`;

  return path.startsWith(prefix) && path.length > prefix.length;
}

export function isWithin(path: string, folder: string): boolean {
  const normalised = withoutTrailingSlashes(folder);

  return path === normalised || isBelow(path, normalised);
}

function homeRelative(path: string, home: string): string | null {
  const normalisedHome = withoutTrailingSlashes(home);

  return isBelow(path, normalisedHome) ? `~${path.slice(normalisedHome.length)}` : null;
}

export type FolderPathCheck =
  | { readonly _tag: "Valid"; readonly path: string }
  | { readonly _tag: "NotAbsolute" }
  | { readonly _tag: "Hidden" };

export function checkFolderPath(options: {
  readonly path: string;
  readonly home: string;
}): FolderPathCheck {
  const path = withoutTrailingSlashes(expandHome(options.path.trim(), options.home));

  if (!path.startsWith("/")) {
    return { _tag: "NotAbsolute" };
  }

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
  | { readonly _tag: "Hidden" }
  | { readonly _tag: "OutsideRoots" }
  | { readonly _tag: "InArchive" };

export function checkCloneDestination(options: {
  readonly destination: string;
  readonly home: string;
  readonly roots: ReadonlyArray<string>;
  readonly archive: string | null;
}): DestinationCheck {
  const folder = checkFolderPath({ path: options.destination, home: options.home });

  if (folder._tag !== "Valid") {
    return folder;
  }

  const { path } = folder;

  const root = options.roots.find((candidate) =>
    isBelow(path, withoutTrailingSlashes(expandHome(candidate, options.home))),
  );

  if (root === undefined) {
    return { _tag: "OutsideRoots" };
  }

  return options.archive !== null && isWithin(path, expandHome(options.archive, options.home))
    ? { _tag: "InArchive" }
    : { _tag: "Valid", path, root };
}

function mostCommon(values: ReadonlyArray<string>): string | undefined {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts].toSorted(([, left], [, right]) => right - left)[0]?.[0];
}

export function cloneSource(repository: Pick<Repository, "checkouts">): string | undefined {
  return mostCommon(
    repository.checkouts.flatMap(({ checkout }) =>
      checkout.originUrl === null ? [] : [checkout.originUrl],
    ),
  );
}

export function suggestCloneDestination(options: {
  readonly repository: Repository;
  readonly target: Machine;
  readonly machines: ReadonlyArray<Machine>;
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
      archive: target.archiveFolder,
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
