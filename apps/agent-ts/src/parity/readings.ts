/**
 * Prints what this agent reads from checkouts, for `scripts/agentParity/compare.mjs` to compare
 * with the Rust agent's `__scan` and `__inspect` output.
 *
 * `node src/parity/readings.ts scan [--archive <folder>] <root>...` prints every checkout discovery
 * finds with its status, and `node src/parity/readings.ts inspect <path> [<worktree>]` prints an inspection that
 * doesn't fetch. `node src/parity/readings.ts t3code <database>` prints what the agent reads from T3
 * Code, with project icons. `node src/parity/readings.ts github <login> <path>` prints what the agent
 * reads from GitHub about the checkout at the path.
 */
import { Console, Duration, Effect, Option, Schema } from "effect";

import { CheckoutStatus, GithubState } from "@fleetfrog/protocol/domain/checkout";
import { T3CodeStatus } from "@fleetfrog/protocol/domain/t3Code";
import { InspectionResult } from "@fleetfrog/protocol/domain/trash";

import { discoverCheckouts } from "../discovery/discoverCheckouts.ts";
import { locateCheckout, readGitStatus } from "../git/readCheckout.ts";
import { makeGithubReader } from "../github/githubReader.ts";
import { inspectCheckout } from "../inspect/inspectCheckout.ts";
import { inspectWorktree } from "../inspect/inspectWorktree.ts";
import { readT3Code } from "../t3Code/readT3Code.ts";

const encodeStatus = Schema.encodeSync(Schema.toCodecJson(CheckoutStatus));
const encodeInspection = Schema.encodeSync(Schema.toCodecJson(InspectionResult));
const encodeT3CodeStatus = Schema.encodeSync(Schema.toCodecJson(T3CodeStatus));
const encodeGithubState = Schema.encodeSync(Schema.toCodecJson(Schema.NullOr(GithubState)));

const scan = (roots: ReadonlyArray<string>, archiveFolder: string | null) =>
  discoverCheckouts({ roots, archiveFolder, projectFolders: [] }).pipe(
    Effect.flatMap((locations) =>
      Effect.forEach(locations, (location) =>
        readGitStatus(location).pipe(
          Effect.match({
            onSuccess: (git) => CheckoutStatus.cases.Read.make({ git }),
            onFailure: ({ message }) => CheckoutStatus.cases.Failed.make({ message }),
          }),
          Effect.map((status) => ({
            path: location.path,
            identity: location.identity,
            originUrl: location.originUrl,
            directoryName: location.directoryName,
            worktree: location.worktree,
            placement: location.placement,
            status: encodeStatus(status),
          })),
        ),
      ),
    ),
  );

const inspect = (path: string, worktree: string | undefined) =>
  locateCheckout(path).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(null),
        onSome: (location) =>
          worktree === undefined
            ? inspectCheckout(location, { fetch: "NotAllowed" }).pipe(
                Effect.map((inspection) =>
                  encodeInspection(InspectionResult.cases.Inspected.make({ inspection })),
                ),
              )
            : inspectWorktree(location, worktree).pipe(
                Effect.map((inspection) =>
                  inspection === null
                    ? null
                    : encodeInspection(
                        InspectionResult.cases.WorktreeInspected.make({ inspection }),
                      ),
                ),
              ),
      }),
    ),
  );

const t3Code = (database: string) =>
  readT3Code({ database, projectIcons: true, favicons: new Map() }).pipe(
    Effect.map(({ status, icons }) => ({ status: encodeT3CodeStatus(status), icons })),
  );

const github = (login: string, path: string) =>
  locateCheckout(path).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(null),
        onSome: (location) =>
          readGitStatus(location).pipe(
            Effect.flatMap((git) =>
              makeGithubReader({ login })({
                location,
                localBranches: git.branches.items.map(({ name }) => name),
                maximumAge: Duration.zero,
              }),
            ),
            Effect.map((state) => encodeGithubState(Option.getOrNull(state))),
          ),
      }),
    ),
  );

const [command = "scan", ...rest] = process.argv.slice(2);
const [first = "", second] = rest;

function read(): Effect.Effect<unknown, unknown> {
  switch (command) {
    case "inspect":
      return inspect(first, second);
    case "t3code":
      return t3Code(first);
    case "github":
      return github(first, second ?? "");
    default:
      return first === "--archive" ? scan(rest.slice(2), second ?? null) : scan(rest, null);
  }
}

await Effect.runPromise(
  read().pipe(Effect.flatMap((readings) => Console.log(JSON.stringify(readings)))),
);
