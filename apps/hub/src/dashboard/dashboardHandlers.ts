import { Effect, Stream } from "effect";

import { DashboardRpcs, RefreshTarget } from "@fleetfrog/protocol/dashboard/rpcs";

import { AgentSessions } from "../agents/agentSessions.ts";
import { FleetFeed } from "../catalogue/fleetFeed.ts";
import { MachineStore } from "../machines/machineStore.ts";
import { PairingOffers } from "../pairing/pairingOffers.ts";
import { PollingStore } from "../settings/pollingStore.ts";
import { DashboardPresence } from "./dashboardPresence.ts";

export const DashboardHandlers = DashboardRpcs.toLayer(
  Effect.gen(function* () {
    const feed = yield* FleetFeed;
    const presence = yield* DashboardPresence;
    const sessions = yield* AgentSessions;
    const machines = yield* MachineStore;
    const polling = yield* PollingStore;
    const offers = yield* PairingOffers;

    return {
      WatchFleet: () => Stream.unwrap(presence.watch.pipe(Effect.as(feed.watch))),
      Refresh: ({ target }) =>
        RefreshTarget.match(target, {
          All: () => sessions.refresh("all"),
          Machine: ({ machineId }) =>
            machines.find(machineId).pipe(Effect.andThen(sessions.refresh([machineId]))),
        }),
      RenameMachine: (rename) => machines.rename(rename).pipe(Effect.andThen(feed.invalidate)),
      SetDiscoveryRoots: (update) =>
        machines
          .setDiscoveryRoots(update)
          .pipe(
            Effect.andThen(sessions.reconfigure(update.machineId)),
            Effect.andThen(feed.invalidate),
          ),
      RemoveMachine: ({ machineId }) =>
        machines
          .remove(machineId)
          .pipe(Effect.andThen(sessions.disconnect(machineId)), Effect.andThen(feed.invalidate)),
      UpdatePolling: ({ polling: settings }) => polling.update(settings),
      CreatePairingOffer: () => offers.create,
    };
  }),
);
