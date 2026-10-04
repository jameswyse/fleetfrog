import { Context, DateTime, Duration, Effect, Layer, PubSub, Stream } from "effect";

import { activityRetentionDays } from "@fleetfrog/protocol/domain/activity";

import { ActivityStore } from "./activityStore.ts";

import type { BatchNotFound } from "@fleetfrog/protocol/dashboard/rpcs";
import type {
  ActivityFilter,
  Actor,
  ActivityPage,
  BatchDetail,
  BatchId,
  HubEvent,
  RunsSnapshot,
} from "@fleetfrog/protocol/domain/activity";

const settleTime = Duration.millis(150);
const pruneInterval = Duration.hours(6);

export class ActivityFeed extends Context.Service<
  ActivityFeed,
  {
    readonly invalidate: Effect.Effect<void>;
    readonly recordEvent: (event: HubEvent, by: Actor) => Effect.Effect<void>;
    readonly watchRuns: Stream.Stream<RunsSnapshot>;
    readonly watchActivity: (query: {
      readonly filter: ActivityFilter;
      readonly limit: number;
    }) => Stream.Stream<ActivityPage>;
    readonly watchBatch: (batchId: BatchId) => Stream.Stream<BatchDetail, BatchNotFound>;
  }
>()("fleetfrog/ActivityFeed") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const store = yield* ActivityStore;
      const invalidations = yield* PubSub.sliding<void>(1);
      const invalidate = PubSub.publish(invalidations, undefined).pipe(Effect.asVoid);

      const onChange = <A, E>(read: Effect.Effect<A, E>) =>
        Stream.merge(Stream.succeed(undefined), Stream.fromPubSub(invalidations)).pipe(
          Stream.debounce(settleTime),
          Stream.mapEffect(() => read),
        );

      yield* DateTime.now.pipe(
        Effect.map(DateTime.subtract({ days: activityRetentionDays })),
        Effect.flatMap(store.prune),
        Effect.andThen(invalidate),
        Effect.andThen(Effect.sleep(pruneInterval)),
        Effect.forever,
        Effect.forkScoped,
      );

      return {
        invalidate,
        recordEvent: (event, by) => store.recordEvent(event, by).pipe(Effect.andThen(invalidate)),
        watchRuns: onChange(
          Effect.all({
            activeBatches: store.activeBatches,
            active: store.activeRuns,
            latest: store.latestRuns,
          }),
        ),
        watchActivity: (query) => onChange(store.activity(query)),
        watchBatch: (batchId) => onChange(store.batch(batchId)),
      };
    }),
  );
}
