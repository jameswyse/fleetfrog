import { existsSync } from "node:fs";

import { DateTime, Effect, Option, Schema, Semaphore } from "effect";

import { ScanReport } from "@fleetfrog/protocol/agent/rpcs";
import { Checkout, CheckoutStatus } from "@fleetfrog/protocol/domain/checkout";

import { discoverCheckouts } from "../discovery/discoverCheckouts.ts";
import { readGitStatus } from "../git/readCheckout.ts";
import { makeGithubReader } from "../github/githubReader.ts";

import type { Duration } from "effect";

import type { CheckoutLocation } from "../git/readCheckout.ts";

const readConcurrency = 4;
const encodeCheckout = Schema.encodeSync(Schema.toCodecJson(Checkout));

const epoch = DateTime.makeUnsafe(0);

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
  readonly githubEnabled: boolean;
  readonly report: (report: ScanReport) => Effect.Effect<void, ReportError>;
}) {
  const readGithub = makeGithubReader();
  const lock = Semaphore.makeUnsafe(1);
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
    const github =
      options.githubEnabled && git._tag === "Success"
        ? yield* readGithub({
            location,
            localBranches: git.success.branches.items.map(({ name }) => name),
            maximumAge: githubMaximumAge,
          })
        : Option.none();

    return {
      path: location.path,
      identity: location.identity,
      directoryName: location.directoryName,
      worktree: location.worktree,
      status,
      github: Option.getOrNull(github),
      scannedAt: yield* DateTime.now,
    } satisfies Checkout;
  });

  const readAll = (githubMaximumAge: Duration.Duration) =>
    Effect.forEach(locations, (location) => readCheckout(location, githubMaximumAge), {
      concurrency: readConcurrency,
    });

  return {
    /** Walks the roots, reads every checkout found and replaces the hub's inventory. */
    discover: (discovery: {
      readonly roots: ReadonlyArray<string>;
      readonly githubMaximumAge: Duration.Duration;
    }) =>
      Effect.gen(function* () {
        locations = yield* discoverCheckouts(discovery.roots);

        const checkouts = yield* readAll(discovery.githubMaximumAge);

        yield* options.report(
          ScanReport.cases.Discovery.make({ checkouts, completedAt: yield* DateTime.now }),
        );
        sent.clear();

        for (const checkout of checkouts) {
          sent.set(checkout.path, contentKey(checkout));
        }
      }).pipe(lock.withPermits(1)),

    /** Rereads known checkouts and reports only those that changed or disappeared. */
    status: (githubMaximumAge: Duration.Duration) =>
      Effect.gen(function* () {
        const removedPaths = locations
          .filter((location) => !existsSync(location.path))
          .map(({ path }) => path);

        locations = locations.filter((location) => !removedPaths.includes(location.path));

        const changed = (yield* readAll(githubMaximumAge)).filter(
          (checkout) => sent.get(checkout.path) !== contentKey(checkout),
        );

        yield* options.report(
          ScanReport.cases.Status.make({ changed, removedPaths, completedAt: yield* DateTime.now }),
        );

        for (const path of removedPaths) {
          sent.delete(path);
        }

        for (const checkout of changed) {
          sent.set(checkout.path, contentKey(checkout));
        }
      }).pipe(lock.withPermits(1)),
  };
}
