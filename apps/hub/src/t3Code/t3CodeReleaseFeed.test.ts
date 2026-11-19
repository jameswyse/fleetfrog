import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Layer, Stream, SubscriptionRef } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";

import { TestDatabase } from "../persistence/testDatabase.ts";
import { IntegrationsStore } from "../settings/integrationsStore.ts";
import { newestT3CodeReleases, T3CodeReleaseFeed } from "./t3CodeReleaseFeed.ts";

describe("newestT3CodeReleases", () => {
  it("takes the first published release on each channel from GitHub's newest-first list", () => {
    expect(
      newestT3CodeReleases([
        { tag_name: "v0.0.47-nightly.20261013.3050", draft: true },
        { tag_name: "v0.0.46-nightly.20261012.3021", draft: false },
        { tag_name: "desktop-v0.0.46", draft: false },
        { tag_name: "v0.0.46-nightly.20261011.2980", draft: false },
        { tag_name: "v0.0.45", draft: false },
        { tag_name: "v0.0.44", draft: false },
      ]),
    ).toStrictEqual({ stable: "0.0.45", nightly: "0.0.46-nightly.20261012.3021", preview: null });
  });
});

function gitHubAnswering(answers: Array<Effect.Effect<ReadonlyArray<string>>>) {
  return HttpClient.make((request) =>
    (answers.shift() ?? Effect.never).pipe(
      Effect.map((tags) =>
        HttpClientResponse.fromWeb(
          request,
          Response.json(tags.map((tag_name) => ({ tag_name, draft: false }))),
        ),
      ),
    ),
  );
}

describe("T3CodeReleaseFeed", () => {
  it.effect("keeps the last releases through a stalled check and recovers on the next", () =>
    Effect.gen(function* () {
      const { releases } = yield* T3CodeReleaseFeed;

      const stableReleaseIs = (version: string) =>
        SubscriptionRef.changes(releases).pipe(
          Stream.filter(({ stable }) => stable === version),
          Stream.runHead,
        );

      yield* stableReleaseIs("1.0.0");
      yield* TestClock.adjust(Duration.hours(1));
      yield* TestClock.adjust(Duration.minutes(1));

      expect((yield* SubscriptionRef.get(releases)).stable).toBe("1.0.0");

      yield* TestClock.adjust(Duration.hours(1));
      yield* stableReleaseIs("1.1.0");
    }).pipe(
      Effect.provide(
        T3CodeReleaseFeed.layer.pipe(
          Layer.provide([
            Layer.succeed(
              HttpClient.HttpClient,
              gitHubAnswering([
                Effect.succeed(["v1.0.0"]),
                Effect.never,
                Effect.succeed(["v1.1.0"]),
              ]),
            ),
            IntegrationsStore.layer.pipe(Layer.provide(TestDatabase)),
          ]),
        ),
      ),
    ),
  );
});
