import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";

import { DateTime, Deferred, Duration, Effect, Option, Schema, Semaphore } from "effect";

import { ScanReport } from "@fleetfrog/protocol/agent/rpcs";
import { Checkout, CheckoutStatus } from "@fleetfrog/protocol/domain/checkout";
import { T3CodeStatus } from "@fleetfrog/protocol/domain/t3Code";

import {
  archivePath,
  discoverCheckouts,
  repositoryCheckouts,
  rootPath,
} from "../discovery/discoverCheckouts.ts";
import { readGitStatus } from "../git/readCheckout.ts";
import { makeGithubReader } from "../github/githubReader.ts";
import { readT3Code, t3CodeDatabasePath } from "../t3Code/readT3Code.ts";
import { listTrash } from "../trash/trashFolder.ts";

import type {
  ProjectIconFile,
  ReportedRoot,
  T3CodeAgentSettings,
} from "@fleetfrog/protocol/agent/rpcs";

import type { CheckoutLocation } from "../git/readCheckout.ts";

const readConcurrency = 4;
const encodeCheckout = Schema.encodeSync(Schema.toCodecJson(Checkout));
const encodeT3CodeStatus = Schema.encodeSync(Schema.toCodecJson(T3CodeStatus));

const epoch = DateTime.makeUnsafe(0);

/**
 * What is at each discovery folder and the Archive folder, so the dashboard can point out a
 * mistyped or missing one.
 */
function inspectRoots(roots: ReadonlyArray<string>) {
  return Effect.promise(() =>
    Promise.all(
      roots.map((root) =>
        stat(rootPath(root)).then(
          (found): ReportedRoot => ({
            path: root,
            status: found.isDirectory() ? "Folder" : "NotFolder",
          }),
          (): ReportedRoot => ({ path: root, status: "Missing" }),
        ),
      ),
    ),
  );
}

/** A checkout's content with its timestamps blanked, so unchanged checkouts are not resent. */
function contentKey(checkout: Checkout): string {
  return JSON.stringify(
    encodeCheckout({
      ...checkout,
      scannedAt: epoch,
      github: checkout.github === null ? null : { ...checkout.github, checkedAt: epoch },
    }),
  );
}

/**
 * Discovers and reads this machine's checkouts, and turns each pass into a report for the hub.
 * Passes never overlap.
 */
export function makeScanner<ReportError>(options: {
  /** The GitHub CLI's signed-in user, or `null` when GitHub state is unavailable. */
  readonly githubLogin: string | null;
  /** Where trashed checkouts are kept. */
  readonly trashDirectory: string;
  /** The project folders and Archive folder the hub last configured. */
  readonly folders: () => {
    readonly roots: ReadonlyArray<string>;
    readonly archiveFolder: string | null;
  };
  readonly report: (report: ScanReport) => Effect.Effect<void, ReportError>;
}) {
  const readGithub =
    options.githubLogin === null ? null : makeGithubReader({ login: options.githubLogin });
  const lock = Semaphore.makeUnsafe(1);
  /** Numbers requests and pass starts in the order they happen, so no two compare as equal. */
  let sequence = 0;
  /** The number each kind of pass last started at. */
  const started = { discovery: 0, status: 0 };
  /** Done once the first discovery walk has found the checkouts, so they can be located. */
  const firstWalk = Deferred.makeUnsafe<void>();

  /**
   * Runs passes one at a time. A pass that started after this one was requested has already
   * covered it, so a burst of requests collapses into one pass.
   */
  const serialise = <E>(kind: keyof typeof started, pass: Effect.Effect<void, E>) =>
    Effect.suspend(() => {
      sequence += 1;

      const requested = sequence;

      return Effect.suspend(() => {
        if (started[kind] > requested) {
          return Effect.void;
        }

        sequence += 1;
        started[kind] = sequence;

        return pass;
      }).pipe(lock.withPermits(1));
    });
  let locations: ReadonlyArray<CheckoutLocation> = [];
  const sent = new Map<string, string>();
  const t3CodeDatabase = t3CodeDatabasePath();
  /** Each T3 Code project's favicon, looked for again on every discovery walk. */
  const favicons = new Map<string, ProjectIconFile | null>();
  /** What was last sent about T3 Code, so an unchanged reading isn't resent every pass. */
  let sentT3Code: string | null = null;
  /** The icon hashes last sent, so their images are only resent when the set changes. */
  let sentIcons: string | null = null;

  /** Reads T3 Code while the integration is on. */
  const readIntegration = (settings: T3CodeAgentSettings | null) =>
    settings === null
      ? Effect.succeed(null)
      : readT3Code({ database: t3CodeDatabase, projectIcons: settings.projectIcons, favicons });

  const reportIntegration = Effect.fnUntraced(function* (
    read: Effect.Success<ReturnType<typeof readIntegration>>,
  ) {
    if (read === null) {
      return;
    }

    const status = JSON.stringify(encodeT3CodeStatus(read.status));

    if (status !== sentT3Code) {
      yield* options.report(ScanReport.cases.T3Code.make({ status: read.status }));
      sentT3Code = status;
    }

    const icons = read.icons
      .map(({ id }) => id)
      .toSorted()
      .join(",");

    if (icons !== sentIcons) {
      yield* options.report(ScanReport.cases.ProjectIcons.make({ icons: read.icons }));
      sentIcons = icons;
    }
  });

  const readCheckout = Effect.fn("readCheckout")(function* (
    location: CheckoutLocation,
    githubMaximumAge: Duration.Duration,
  ) {
    const git = yield* readGitStatus(location).pipe(Effect.result);
    const status =
      git._tag === "Success"
        ? CheckoutStatus.cases.Read.make({ git: git.success })
        : CheckoutStatus.cases.Failed.make({ message: git.failure.message });
    // Archived checkouts don't need GitHub's view, which costs a request per repository.
    const github =
      readGithub !== null && git._tag === "Success" && location.placement._tag === "Projects"
        ? yield* readGithub({
            location,
            localBranches: git.success.branches.items.map(({ name }) => name),
            maximumAge: githubMaximumAge,
          })
        : Option.none();

    return {
      path: location.path,
      identity: location.identity,
      originUrl: location.originUrl,
      directoryName: location.directoryName,
      worktree: location.worktree,
      placement: location.placement,
      status,
      github: Option.getOrNull(github),
      scannedAt: yield* DateTime.now,
    } satisfies Checkout;
  });

  const readAll = (targets: ReadonlyArray<CheckoutLocation>, githubMaximumAge: Duration.Duration) =>
    Effect.forEach(targets, (location) => readCheckout(location, githubMaximumAge), {
      concurrency: readConcurrency,
    });

  /** Reports rereads that changed since they were last sent, and checkouts that went. */
  const reportChanged = (
    checkouts: ReadonlyArray<Checkout>,
    removedPaths: ReadonlyArray<string> = [],
  ) =>
    Effect.gen(function* () {
      const changed = checkouts.filter(
        (checkout) => sent.get(checkout.path) !== contentKey(checkout),
      );

      if (changed.length === 0 && removedPaths.length === 0) {
        return;
      }

      yield* options.report(
        ScanReport.cases.Status.make({
          changed,
          removedPaths,
          completedAt: yield* DateTime.now,
        }),
      );
      // Only a delivered report retires checkouts that went, so a failed one leaves them for the
      // next status pass, which finds them gone.
      locations = locations.filter((location) => !removedPaths.includes(location.path));

      for (const path of removedPaths) {
        sent.delete(path);
      }

      for (const checkout of changed) {
        sent.set(checkout.path, contentKey(checkout));
      }
    });

  const reportTrash = listTrash(options.trashDirectory).pipe(
    Effect.flatMap((items) => options.report(ScanReport.cases.Trash.make({ items }))),
  );

  return {
    reportTrash,

    /**
     * Walks the roots and the Archive folder, reads every checkout found and replaces the hub's
     * inventory.
     */
    discover: (discovery: {
      readonly roots: ReadonlyArray<string>;
      readonly archiveFolder: string | null;
      readonly githubMaximumAge: Duration.Duration;
      readonly t3Code: T3CodeAgentSettings | null;
    }) =>
      serialise(
        "discovery",
        Effect.gen(function* () {
          favicons.clear();

          const integration = yield* readIntegration(discovery.t3Code);
          const found = yield* discoverCheckouts({
            roots: discovery.roots,
            archiveFolder: discovery.archiveFolder,
            projectFolders:
              discovery.t3Code?.discoverProjects === true &&
              integration?.status.reading._tag === "Read"
                ? integration.status.reading.projects.map(({ path }) => path)
                : [],
          });

          // Actions can find the checkouts at once, while their status is still being read.
          locations = found;
          yield* Deferred.succeed(firstWalk, undefined);

          const checkouts = yield* readAll(found, discovery.githubMaximumAge);
          const roots = yield* inspectRoots(
            discovery.archiveFolder === null
              ? discovery.roots
              : [...discovery.roots, discovery.archiveFolder],
          );

          yield* options.report(
            ScanReport.cases.Discovery.make({ checkouts, roots, completedAt: yield* DateTime.now }),
          );
          yield* reportTrash;
          yield* reportIntegration(integration);
          sent.clear();

          for (const checkout of checkouts) {
            sent.set(checkout.path, contentKey(checkout));
          }
        }),
      ),

    /**
     * Rereads known checkouts and reports only those that changed or disappeared. Archived
     * checkouts are only checked for, since nothing works on them.
     */
    status: (pass: {
      readonly githubMaximumAge: Duration.Duration;
      readonly t3Code: T3CodeAgentSettings | null;
    }) =>
      serialise(
        "status",
        Effect.gen(function* () {
          const { githubMaximumAge } = pass;
          const present = locations.filter((location) => existsSync(location.path));
          const removedPaths = locations
            .filter((location) => !present.includes(location))
            .map(({ path }) => path);
          const active = present.filter(({ placement }) => placement._tag === "Projects");
          const changed = (yield* readAll(active, githubMaximumAge)).filter(
            (checkout) => sent.get(checkout.path) !== contentKey(checkout),
          );

          yield* options.report(
            ScanReport.cases.Status.make({
              changed,
              removedPaths,
              completedAt: yield* DateTime.now,
            }),
          );
          // Only a delivered report retires removed checkouts, so a failed one is retried next pass.
          locations = present;

          for (const path of removedPaths) {
            sent.delete(path);
          }

          for (const checkout of changed) {
            sent.set(checkout.path, contentKey(checkout));
          }

          yield* reportIntegration(yield* readIntegration(pass.t3Code));
        }),
      ),

    /** Waits until the first discovery walk has found the checkouts. */
    discovered: Deferred.await(firstWalk),

    /** The checkout at `path` from the last discovery walk, if any. */
    locate: (path: string): CheckoutLocation | undefined =>
      locations.find((location) => location.path === path),

    /**
     * Rereads every worktree of one repository after an action changed it, asking GitHub again so
     * its default branch compares against what was just fetched.
     */
    rescanRepository: (commonDirectory: string) =>
      Effect.gen(function* () {
        const targets = locations.filter(
          (location) => location.commonDirectory === commonDirectory,
        );

        yield* reportChanged(yield* readAll(targets, Duration.zero));
      }).pipe(lock.withPermits(1)),

    /**
     * Follows a repository whose checkouts moved, arrived or went, as archiving, trashing,
     * restoring, deleting, cloning and removing a worktree do. Drops the checkouts of the
     * repository whose Git directory was `left`, and reads the main checkout at `main` with its
     * linked worktrees wherever they are now. Both go in one report, so the hub never holds the
     * repository half moved.
     */
    followRepository: (left: string | null, main: string | null) =>
      Effect.gen(function* () {
        const found =
          main === null ? [] : yield* repositoryCheckouts(main, archivePath(options.folders()));
        const foundPaths = new Set(found.map(({ path }) => path));
        const removedPaths = locations
          .filter(({ commonDirectory, path }) => commonDirectory === left && !foundPaths.has(path))
          .map(({ path }) => path);

        locations = [...locations.filter(({ path }) => !foundPaths.has(path)), ...found];
        yield* reportChanged(yield* readAll(found, Duration.zero), removedPaths);
      }).pipe(lock.withPermits(1)),
  };
}
