import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";

import { DateTime, Deferred, Duration, Effect, Option, Schema, Semaphore } from "effect";

import { ScanReport } from "@fleetfrog/protocol/agent/rpcs";
import { Checkout, CheckoutStatus } from "@fleetfrog/protocol/domain/checkout";

import {
  archivePath,
  discoverCheckouts,
  placeLocation,
  rootPath,
} from "../discovery/discoverCheckouts.ts";
import { locateCheckout, readGitStatus } from "../git/readCheckout.ts";
import { makeGithubReader } from "../github/githubReader.ts";
import { listTrash } from "../trash/trashFolder.ts";

import type { ReportedRoot } from "@fleetfrog/protocol/agent/rpcs";

import type { CheckoutLocation } from "../git/readCheckout.ts";

const readConcurrency = 4;
const encodeCheckout = Schema.encodeSync(Schema.toCodecJson(Checkout));

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

  /** Reports rereads that changed since they were last sent. */
  const reportChanged = (checkouts: ReadonlyArray<Checkout>) =>
    Effect.gen(function* () {
      const changed = checkouts.filter(
        (checkout) => sent.get(checkout.path) !== contentKey(checkout),
      );

      if (changed.length === 0) {
        return;
      }

      yield* options.report(
        ScanReport.cases.Status.make({
          changed,
          removedPaths: [],
          completedAt: yield* DateTime.now,
        }),
      );

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
    }) =>
      serialise(
        "discovery",
        Effect.gen(function* () {
          const found = yield* discoverCheckouts(discovery);

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
    status: (githubMaximumAge: Duration.Duration) =>
      serialise(
        "status",
        Effect.gen(function* () {
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

    /** Adds a checkout created outside a discovery walk, such as a fresh clone or a moved one. */
    track: (path: string) =>
      Effect.gen(function* () {
        const found = yield* locateCheckout(path);

        if (Option.isNone(found) || locations.some((known) => known.path === path)) {
          return;
        }

        const location = yield* placeLocation(found.value, archivePath(options.folders()));

        locations = [...locations, location];
        yield* reportChanged(yield* readAll([location], Duration.zero));
      }).pipe(lock.withPermits(1)),

    /** Drops a checkout that moved away, such as into the archive or the trash. */
    forget: (path: string) =>
      Effect.gen(function* () {
        if (!locations.some((known) => known.path === path)) {
          return;
        }

        yield* options.report(
          ScanReport.cases.Status.make({
            changed: [],
            removedPaths: [path],
            completedAt: yield* DateTime.now,
          }),
        );
        locations = locations.filter((known) => known.path !== path);
        sent.delete(path);
      }).pipe(lock.withPermits(1)),
  };
}
