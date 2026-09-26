import { homedir } from "node:os";

import { DateTime, Duration, Effect, Option, Schema } from "effect";

import { repositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

import { runCommand, runGit } from "../process/runCommand.ts";

import type { GithubState, PullRequest } from "@fleetfrog/protocol/domain/checkout";
import type { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

import type { CheckoutLocation } from "../git/readCheckout.ts";

const query = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name target { oid } }
    pullRequests(states: OPEN, first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { number title url headRefName isDraft }
    }
  }
}`;

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
  readonly checkedAt: DateTime.Utc;
}

/**
 * Reads default-branch and pull request state from GitHub through `gh`, at most once per
 * repository per interval, however many checkouts share it.
 */
export function makeGithubReader() {
  const cache = new Map<RepositoryKey, RemoteState>();

  const fetchRemote = Effect.fn("fetchGithubRepository")(function* (owner: string, name: string) {
    const output = yield* runCommand("gh", homedir(), [
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `name=${name}`,
    ]);
    const { repository } = (yield* decodeResponse(output)).data;

    return {
      defaultBranch: repository.defaultBranchRef.name,
      remoteSha: repository.defaultBranchRef.target.oid,
      pullRequests: repository.pullRequests.nodes.map((node) => ({
        number: node.number,
        title: node.title,
        url: node.url,
        branch: node.headRefName,
        draft: node.isDraft,
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
      checkedAt: remote.value.checkedAt,
    });
  });
}
