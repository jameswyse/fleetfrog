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
// oxlint-disable-next-line wyse/no-service-constructor-imports -- The scanner builds a reader for the machine's GitHub login.
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

function contentKey(checkout: Checkout): string {
  return JSON.stringify(
    encodeCheckout({
      ...checkout,
      scannedAt: epoch,
      github: checkout.github === null ? null : { ...checkout.github, checkedAt: epoch },
    }),
  );
}

export function makeScanner<ReportError>(options: {
  readonly githubLogin: string | null;
  readonly trashDirectory: string;
  readonly folders: () => {
    readonly roots: ReadonlyArray<string>;
    readonly archiveFolder: string | null;
  };
  readonly report: (report: ScanReport) => Effect.Effect<void, ReportError>;
}) {
  const readGithub =
    options.githubLogin === null ? null : makeGithubReader({ login: options.githubLogin });

  const lock = Semaphore.makeUnsafe(1);
  let sequence = 0;
  const started = { discovery: 0, status: 0 };
  const firstWalk = Deferred.makeUnsafe<void>();

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
  const favicons = new Map<string, ProjectIconFile | null>();
  let sentT3Code: string | null = null;
  let sentIcons: string | null = null;

  const readIntegration = (settings: T3CodeAgentSettings | null) =>
    settings === null
      ? Effect.succeed(null)
      : readT3Code({
          database: t3CodeDatabasePath(),
          projectIcons: settings.projectIcons,
          favicons,
        });

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

    discovered: Deferred.await(firstWalk),

    locate: (path: string): CheckoutLocation | undefined =>
      locations.find((location) => location.path === path),

    rescanRepository: (commonDirectory: string) =>
      Effect.gen(function* () {
        const targets = locations.filter(
          (location) => location.commonDirectory === commonDirectory,
        );

        yield* reportChanged(yield* readAll(targets, Duration.zero));
      }).pipe(lock.withPermits(1)),

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
