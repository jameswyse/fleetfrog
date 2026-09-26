import { Context, Effect, Layer, SubscriptionRef } from "effect";

import type { Scope } from "effect";

/** Counts open dashboards so agents can poll faster while someone is watching. */
export class DashboardPresence extends Context.Service<
  DashboardPresence,
  {
    readonly watchers: SubscriptionRef.SubscriptionRef<number>;
    /** Counts the caller as a watcher until its scope closes. */
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
