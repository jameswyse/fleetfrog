import { Effect, Stream } from "effect";

import { DashboardRpcs, RefreshTarget } from "@fleetfrog/protocol/dashboard/rpcs";
import { FolderOutcome, machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { ActionDispatcher } from "../actions/actionDispatcher.ts";
import { ActivityFeed } from "../activity/activityFeed.ts";
import { AgentSessions } from "../agents/agentSessions.ts";
import { FolderRequests } from "../agents/folderRequests.ts";
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
    const dispatcher = yield* ActionDispatcher;
    const activity = yield* ActivityFeed;
    const folders = yield* FolderRequests;

    return {
      WatchFleet: () => Stream.unwrap(presence.watch.pipe(Effect.as(feed.watch))),
      Refresh: ({ target }) =>
        RefreshTarget.match(target, {
          All: () => sessions.refresh("all"),
          Machine: ({ machineId }) =>
            machines.find(machineId).pipe(Effect.andThen(sessions.refresh([machineId]))),
        }),
      RenameMachine: (rename) =>
        Effect.gen(function* () {
          const before = yield* machines.find(rename.machineId);

          yield* machines.rename(rename);
          yield* feed.invalidate;
          yield* activity.recordEvent({
            _tag: "MachineRenamed",
            machineId: rename.machineId,
            from: machineLabel(before),
            to: machineLabel({ ...before, customName: rename.customName }),
          });
        }),
      SetMachineKind: (update) => machines.setKind(update).pipe(Effect.andThen(feed.invalidate)),
      SetDiscoveryRoots: (update) =>
        Effect.gen(function* () {
          const machine = yield* machines.find(update.machineId);

          yield* machines.setDiscoveryRoots(update);
          yield* sessions.reconfigure(update.machineId);
          yield* feed.invalidate;
          yield* activity.recordEvent({
            _tag: "DiscoveryRootsChanged",
            machineId: update.machineId,
            machineName: machineLabel(machine),
            roots: update.roots,
          });
        }),
      CreateProjectFolder: ({ machineId, path }) =>
        Effect.gen(function* () {
          const machine = yield* machines.find(machineId);

          // Only a folder the machine is set to search, which its agent also checks.
          if (!machine.discoveryRoots.includes(path)) {
            return FolderOutcome.cases.Failed.make({
              message: `${path} isn't one of ${machineLabel(machine)}'s project folders.`,
            });
          }

          const outcome = yield* folders.create(machineId, path);

          if (outcome._tag === "Created") {
            yield* activity.recordEvent({
              _tag: "ProjectFolderCreated",
              machineId,
              machineName: machineLabel(machine),
              path,
            });
          }

          return outcome;
        }),
      RemoveMachine: ({ machineId }) =>
        Effect.gen(function* () {
          const machine = yield* machines.find(machineId);

          yield* machines.remove(machineId);
          yield* sessions.disconnect(machineId);
          yield* feed.invalidate;
          yield* activity.recordEvent({
            _tag: "MachineRemoved",
            machineId,
            machineName: machineLabel(machine),
          });
        }),
      UpdatePolling: ({ polling: settings }) =>
        polling
          .update(settings)
          .pipe(
            Effect.andThen(activity.recordEvent({ _tag: "PollingChanged", polling: settings })),
          ),
      CreatePairingOffer: () => offers.create,
      StartBatch: ({ request }) =>
        dispatcher.start(request).pipe(Effect.map((batchId) => ({ batchId }))),
      Cancel: ({ target }) => dispatcher.cancel(target),
      WatchRuns: () => activity.watchRuns,
      WatchActivity: (query) => activity.watchActivity(query),
      WatchBatch: ({ batchId }) => activity.watchBatch(batchId),
    };
  }),
);
