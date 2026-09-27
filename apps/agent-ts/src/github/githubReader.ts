import { homedir } from "node:os";

import { DateTime, Duration, Effect, Option, Schema } from "effect";

import { repositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

import { runGit, runTool } from "../process/runTool.ts";

import type {
  GithubState,
  MergedPullRequest,
  PullRequest,
} from "@fleetfrog/protocol/domain/checkout";
import type { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

import type { CheckoutLocation } from "../git/readCheckout.ts";

const query = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name target { oid } }
    pullRequests(states: OPEN, first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { number title url headRefName isDraft isCrossRepository headRepositoryOwner { login } }
    }
    merged: pullRequests(states: MERGED, first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { number url headRefName headRefOid isCrossRepository headRepositoryOwner { login } }
    }
  }
}`;

// Null when the fork that opened the pull request has been deleted.
const HeadOwner = Schema.NullOr(Schema.Struct({ login: Schema.String }));

const RepositoryResponse = Schema.fromJsonString(
  Schema.Struct({
    data: Schema.Struct({
      repository: Schema.Struct({
        defaultBranchRef: Schema.Struct({
          name: Schema.String,
          target: Schema.Struct({ oid: Schema.String }),
        }),
        pullRequests: Schema.Struct({
          nodes: Schema.Array(
            Schema.Struct({
              number: Schema.Int,
              title: Schema.String,
              url: Schema.String,
              headRefName: Schema.String,
              isDraft: Schema.Boolean,
              isCrossRepository: Schema.Boolean,
              headRepositoryOwner: HeadOwner,
            }),
          ),
        }),
        merged: Schema.Struct({
          nodes: Schema.Array(
            Schema.Struct({
              number: Schema.Int,
              url: Schema.String,
              headRefName: Schema.String,
              headRefOid: Schema.String,
              isCrossRepository: Schema.Boolean,
              headRepositoryOwner: HeadOwner,
            }),
          ),
        }),
      }),
    }),
  }),
);
const decodeResponse = Schema.decodeUnknownEffect(RepositoryResponse);

interface RemoteState {
  readonly defaultBranch: string;
  readonly remoteSha: string;
  readonly pullRequests: ReadonlyArray<PullRequest>;
  readonly mergedPullRequests: ReadonlyArray<MergedPullRequest>;
  readonly checkedAt: DateTime.Utc;
}

/**
 * The first retry after GitHub fails to return a repository. Each failure in a row doubles it, up
 * to the GitHub interval, so a brief outage clears quickly and a repository we can't see is asked
 * about rarely.
 */
const firstRetry = Duration.minutes(1);

export function retryDelay(failures: number, maximumAge: Duration.Duration): Duration.Duration {
  return Duration.min(Duration.times(firstRetry, 2 ** Math.max(failures - 1, 0)), maximumAge);
}

type Reading =
  | { readonly _tag: "Read"; readonly state: RemoteState }
  | {
      readonly _tag: "Unavailable";
      readonly error: string;
      readonly failures: number;
      readonly checkedAt: DateTime.Utc;
    };

/**
 * Reads default-branch and pull request state from GitHub through `gh`, at most once per
 * repository per interval, however many checkouts share it. A repository GitHub won't return is
 * retried less and less often, and logged only when its error changes.
 */
export function makeGithubReader(reader: {
  /** The signed-in GitHub user, whose fork's pull requests also count as this repository's. */
  readonly login: string;
}) {
  const cache = new Map<RepositoryKey, Reading>();

  const fetchRemote = Effect.fn("fetchGithubRepository")(function* (owner: string, name: string) {
    const output = yield* runTool("gh", homedir(), [
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      // `-f` sends raw strings; `-F` would turn a repository called `2048` into a number.
      "-f",
      `owner=${owner}`,
      "-f",
      `name=${name}`,
    ]);
    const { repository } = (yield* decodeResponse(output)).data;
    // A fork's `main` is not the local `main`, so only branches pushed here or to our fork match.
    const ours = (node: {
      readonly isCrossRepository: boolean;
      readonly headRepositoryOwner: typeof HeadOwner.Type;
    }) => !node.isCrossRepository || node.headRepositoryOwner?.login === reader.login;

    return {
      defaultBranch: repository.defaultBranchRef.name,
      remoteSha: repository.defaultBranchRef.target.oid,
      pullRequests: repository.pullRequests.nodes.filter(ours).map((node) => ({
        number: node.number,
        title: node.title,
        url: node.url,
        branch: node.headRefName,
        draft: node.isDraft,
      })),
      mergedPullRequests: repository.merged.nodes.filter(ours).map((node) => ({
        number: node.number,
        url: node.url,
        branch: node.headRefName,
        sha: node.headRefOid,
      })),
      checkedAt: yield* DateTime.now,
    } satisfies RemoteState;
  });

  /** Returns `None` for repositories not hosted on GitHub or when GitHub cannot be reached. */
  return Effect.fn("readGithubState")(function* (options: {
    readonly location: CheckoutLocation;
    readonly localBranches: ReadonlyArray<string>;
    readonly maximumAge: Duration.Duration;
  }) {
    const { identity } = options.location;
    const [owner, name, ...rest] = identity._tag === "Remote" ? identity.path.split("/") : [];

    if (
      identity._tag !== "Remote" ||
      identity.host !== "github.com" ||
      !owner ||
      !name ||
      rest.length > 0
    ) {
      return Option.none<GithubState>();
    }

    const key = repositoryKey(identity);
    const now = yield* DateTime.now;
    const previous = cache.get(key);
    const fresh =
      previous !== undefined &&
      Duration.isLessThan(
        DateTime.distance(
          previous._tag === "Read" ? previous.state.checkedAt : previous.checkedAt,
          now,
        ),
        previous._tag === "Read"
          ? options.maximumAge
          : retryDelay(previous.failures, options.maximumAge),
      );
    const reading: Reading = fresh
      ? previous
      : yield* fetchRemote(owner, name).pipe(
          Effect.map((state): Reading => ({ _tag: "Read", state })),
          Effect.tap(() =>
            previous?._tag === "Unavailable"
              ? Effect.logInfo(`GitHub state for ${identity.path} is available again`)
              : Effect.void,
          ),
          Effect.catch(({ message }) =>
            Effect.gen(function* () {
              const repeated = previous?._tag === "Unavailable" && previous.error === message;

              if (!repeated) {
                yield* Effect.logWarning(`GitHub state unavailable for ${identity.path}`, message);
              }

              return {
                _tag: "Unavailable",
                error: message,
                failures: previous?._tag === "Unavailable" ? previous.failures + 1 : 1,
                checkedAt: yield* DateTime.now,
              } satisfies Reading;
            }),
          ),
          Effect.tap((fetched) => Effect.sync(() => cache.set(key, fetched))),
        );

    if (reading._tag === "Unavailable") {
      return Option.none<GithubState>();
    }

    const remote = reading.state;

    const trackingSha = yield* runGit(options.location.path, [
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/remotes/origin/${remote.defaultBranch}`,
    ]).pipe(
      Effect.map((sha) => sha.trim()),
      Effect.orElseSucceed(() => null),
    );
    const branches = new Set(options.localBranches);

    return Option.some<GithubState>({
      defaultBranch: remote.defaultBranch,
      remoteSha: remote.remoteSha,
      trackingSha,
      pullRequests: remote.pullRequests.filter(({ branch }) => branches.has(branch)),
      mergedPullRequests: remote.mergedPullRequests.filter(({ branch }) => branches.has(branch)),
      checkedAt: remote.checkedAt,
    });
  });
}
