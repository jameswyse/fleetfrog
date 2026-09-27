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
 * Reads default-branch and pull request state from GitHub through `gh`, at most once per
 * repository per interval, however many checkouts share it.
 */
export function makeGithubReader(reader: {
  /** The signed-in GitHub user, whose fork's pull requests also count as this repository's. */
  readonly login: string;
}) {
  const cache = new Map<RepositoryKey, RemoteState>();

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
    const cached = cache.get(key);
    const fresh =
      cached !== undefined &&
      Duration.isLessThan(DateTime.distance(cached.checkedAt, now), options.maximumAge);
    const remote = fresh
      ? Option.some(cached)
      : yield* fetchRemote(owner, name).pipe(
          Effect.tap((state) => Effect.sync(() => cache.set(key, state))),
          Effect.tapError((error) => Effect.logWarning("GitHub state unavailable", error)),
          Effect.option,
        );

    if (Option.isNone(remote)) {
      return Option.none<GithubState>();
    }

    const trackingSha = yield* runGit(options.location.path, [
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/remotes/origin/${remote.value.defaultBranch}`,
    ]).pipe(
      Effect.map((sha) => sha.trim()),
      Effect.orElseSucceed(() => null),
    );
    const branches = new Set(options.localBranches);

    return Option.some<GithubState>({
      defaultBranch: remote.value.defaultBranch,
      remoteSha: remote.value.remoteSha,
      trackingSha,
      pullRequests: remote.value.pullRequests.filter(({ branch }) => branches.has(branch)),
      mergedPullRequests: remote.value.mergedPullRequests.filter(({ branch }) =>
        branches.has(branch),
      ),
      checkedAt: remote.value.checkedAt,
    });
  });
}
