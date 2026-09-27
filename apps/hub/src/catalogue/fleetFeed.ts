import { Context, Duration, Effect, Layer, PubSub, Stream, SubscriptionRef } from "effect";

import { AgentSessions } from "../agents/agentSessions.ts";
import { MachineStore } from "../machines/machineStore.ts";
import { IntegrationsStore } from "../settings/integrationsStore.ts";
import { PollingStore } from "../settings/pollingStore.ts";
import { buildFleet } from "./buildFleet.ts";
import { CheckoutStore } from "./checkoutStore.ts";

import type { Fleet } from "@fleetfrog/protocol/domain/fleet";

/** Bursts of reports during a scan collapse into one dashboard update. */
const settleTime = Duration.millis(150);

/** The dashboard's view of the fleet, rebuilt from storage whenever something changes. */
export class FleetFeed extends Context.Service<
  FleetFeed,
  {
    /** Signals that stored machines or checkouts changed. */
    readonly invalidate: Effect.Effect<void>;
    readonly current: Effect.Effect<Fleet>;
    /** Emits the fleet on subscribe and again after every change. */
    readonly watch: Stream.Stream<Fleet>;
  }
>()("fleetfrog/FleetFeed") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const machines = yield* MachineStore;
      const checkouts = yield* CheckoutStore;
      const sessions = yield* AgentSessions;
      const polling = yield* PollingStore;
      const integrations = yield* IntegrationsStore;
      const invalidations = yield* PubSub.sliding<void>(1);

      const current = Effect.all({
        machines: machines.all,
        checkouts: checkouts.all,
        online: SubscriptionRef.get(sessions.online),
        polling: SubscriptionRef.get(polling.settings),
        integrations: SubscriptionRef.get(integrations.settings),
      }).pipe(Effect.map(buildFleet));

      return {
        invalidate: PubSub.publish(invalidations, undefined).pipe(Effect.asVoid),
        current,
        watch: Stream.mergeAll(
          [
            Stream.fromPubSub(invalidations),
            SubscriptionRef.changes(sessions.online).pipe(Stream.as(undefined)),
            SubscriptionRef.changes(polling.settings).pipe(Stream.as(undefined)),
            SubscriptionRef.changes(integrations.settings).pipe(Stream.as(undefined)),
          ],
          { concurrency: "unbounded" },
        ).pipe(
          Stream.debounce(settleTime),
          Stream.mapEffect(() => current),
        ),
      };
    }),
  );
}
