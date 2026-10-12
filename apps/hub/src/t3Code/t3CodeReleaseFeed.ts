import { Context, Duration, Effect, flow, Layer, Schema, SubscriptionRef } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import { t3CodeChannel, unknownT3CodeReleases } from "@fleetfrog/protocol/domain/t3CodeUpdate";

import packageJson from "../../package.json" with { type: "json" };
import { IntegrationsStore } from "../settings/integrationsStore.ts";

import type { T3CodeChannel, T3CodeReleases } from "@fleetfrog/protocol/domain/t3CodeUpdate";

const releasesUrl = "https://api.github.com/repos/pingdotgg/t3code/releases";
const releasesPerPage = 100;
const maximumPages = 5;
const refreshInterval = Duration.hours(1);

export const GitHubRelease = Schema.Struct({ tag_name: Schema.String, draft: Schema.Boolean });
export type GitHubRelease = typeof GitHubRelease.Type;

export function newestT3CodeReleases(releases: ReadonlyArray<GitHubRelease>): T3CodeReleases {
  const newest: Record<T3CodeChannel, string | null> = { ...unknownT3CodeReleases };

  for (const release of releases) {
    const version = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(release.tag_name)?.[1];

    if (!release.draft && version !== undefined) {
      newest[t3CodeChannel(version)] ??= version;
    }
  }

  return newest;
}

export class T3CodeReleaseFeed extends Context.Service<
  T3CodeReleaseFeed,
  { readonly releases: SubscriptionRef.SubscriptionRef<T3CodeReleases> }
>()("fleetfrog/T3CodeReleaseFeed") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(
          flow(
            HttpClientRequest.setHeader("accept", "application/vnd.github+json"),
            HttpClientRequest.setHeader("user-agent", `FleetFrog/${packageJson.version}`),
          ),
        ),
        HttpClient.filterStatusOk,
      );

      const integrations = yield* IntegrationsStore;
      const releases = yield* SubscriptionRef.make(unknownT3CodeReleases);

      const page = (number: number) =>
        client
          .get(releasesUrl, { urlParams: { per_page: releasesPerPage, page: number } })
          .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Array(GitHubRelease))));

      const fetchNewest = Effect.gen(function* () {
        const seen: Array<GitHubRelease> = [];

        for (let number = 1; number <= maximumPages; number += 1) {
          const listed = yield* page(number);

          seen.push(...listed);

          const newest = newestT3CodeReleases(seen);

          if (
            listed.length < releasesPerPage ||
            Object.values(newest).every((version) => version !== null)
          ) {
            return newest;
          }
        }

        return newestT3CodeReleases(seen);
      });

      const refresh = Effect.gen(function* () {
        const { t3Code } = yield* SubscriptionRef.get(integrations.settings);

        if (t3Code.enabled) {
          yield* SubscriptionRef.set(releases, yield* fetchNewest);
        }
      });

      yield* refresh.pipe(
        Effect.catch((error) =>
          Effect.logWarning(`Couldn't check GitHub for T3 Code releases: ${error.message}`),
        ),
        Effect.andThen(Effect.sleep(refreshInterval)),
        Effect.forever,
        Effect.forkScoped,
      );

      return { releases };
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));

  static fixed(releases: T3CodeReleases) {
    return Layer.effect(this)(
      SubscriptionRef.make(releases).pipe(Effect.map((ref) => ({ releases: ref }))),
    );
  }
}
