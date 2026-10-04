import { Context, Effect, Layer, SubscriptionRef } from "effect";

import type { Scope } from "effect";

export class DashboardPresence extends Context.Service<
  DashboardPresence,
  {
    readonly watchers: SubscriptionRef.SubscriptionRef<number>;
    readonly watch: Effect.Effect<void, never, Scope.Scope>;
  }
>()("fleetfrog/DashboardPresence") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const watchers = yield* SubscriptionRef.make(0);

      return {
        watchers,
        watch: Effect.acquireRelease(
          SubscriptionRef.update(watchers, (count) => count + 1),
          () => SubscriptionRef.update(watchers, (count) => count - 1),
        ),
      };
    }),
  );
}
