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
  /** The GitHub CLI's signed-in user, or `null` when GitHub state is unavailable. */
  readonly githubLogin: string | null;
  readonly report: (report: ScanReport) => Effect.Effect<void, ReportError>;
}) {
  const readGithub =
    options.githubLogin === null ? null : makeGithubReader({ login: options.githubLogin });
  const lock = Semaphore.makeUnsafe(1);
  const startedAt = { discovery: Number.NEGATIVE_INFINITY, status: Number.NEGATIVE_INFINITY };

  /**
   * Runs passes one at a time. A pass that started after this one was requested has already
   * covered it, so a burst of requests collapses into one pass.
   */
  const serialise = <E>(kind: keyof typeof startedAt, pass: Effect.Effect<void, E>) =>
    Effect.suspend(() => {
      const requestedAt = Date.now();

      return Effect.suspend(() => {
        if (startedAt[kind] >= requestedAt) {
          return Effect.void;
        }

        startedAt[kind] = Date.now();

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
    const github =
      readGithub !== null && git._tag === "Success"
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

  const readAll = (targets: ReadonlyArray<CheckoutLocation>, githubMaximumAge: Duration.Duration) =>
    Effect.forEach(targets, (location) => readCheckout(location, githubMaximumAge), {
      concurrency: readConcurrency,
    });

  return {
    /** Walks the roots, reads every checkout found and replaces the hub's inventory. */
    discover: (discovery: {
      readonly roots: ReadonlyArray<string>;
      readonly githubMaximumAge: Duration.Duration;
    }) =>
      serialise(
        "discovery",
        Effect.gen(function* () {
          const found = yield* discoverCheckouts(discovery.roots);
          const checkouts = yield* readAll(found, discovery.githubMaximumAge);

          yield* options.report(
            ScanReport.cases.Discovery.make({ checkouts, completedAt: yield* DateTime.now }),
          );
          locations = found;
          sent.clear();

          for (const checkout of checkouts) {
            sent.set(checkout.path, contentKey(checkout));
          }
        }),
      ),

    /** Rereads known checkouts and reports only those that changed or disappeared. */
    status: (githubMaximumAge: Duration.Duration) =>
      serialise(
        "status",
        Effect.gen(function* () {
          const present = locations.filter((location) => existsSync(location.path));
          const removedPaths = locations
            .filter((location) => !present.includes(location))
            .map(({ path }) => path);
          const changed = (yield* readAll(present, githubMaximumAge)).filter(
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
  };
}
