import { Effect, Stream } from "effect";

import {
  DashboardRpcs,
  InvalidArchiveFolder,
  RefreshTarget,
} from "@fleetfrog/protocol/dashboard/rpcs";
import { checkArchiveFolder } from "@fleetfrog/protocol/domain/archiveFolder";
import { FolderOutcome, machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { ActionDispatcher } from "../actions/actionDispatcher.ts";
import { ActivityFeed } from "../activity/activityFeed.ts";
import { AgentSessions } from "../agents/agentSessions.ts";
import { FolderRequests } from "../agents/folderRequests.ts";
import { InspectionRequests } from "../agents/inspectionRequests.ts";
import { FleetFeed } from "../catalogue/fleetFeed.ts";
import { ProjectIconStore } from "../catalogue/projectIconStore.ts";
import { MachineStore } from "../machines/machineStore.ts";
import { PairingOffers } from "../pairing/pairingOffers.ts";
import { IntegrationsStore } from "../settings/integrationsStore.ts";
import { PollingStore } from "../settings/pollingStore.ts";
import { DashboardPresence } from "./dashboardPresence.ts";

export const DashboardHandlers = DashboardRpcs.toLayer(
  Effect.gen(function* () {
    const feed = yield* FleetFeed;
    const presence = yield* DashboardPresence;
    const sessions = yield* AgentSessions;
    const machines = yield* MachineStore;
    const polling = yield* PollingStore;
    const integrations = yield* IntegrationsStore;
    const icons = yield* ProjectIconStore;
    const offers = yield* PairingOffers;
    const dispatcher = yield* ActionDispatcher;
    const activity = yield* ActivityFeed;
    const folders = yield* FolderRequests;
    const inspections = yield* InspectionRequests;

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

          // Only a folder the machine is set to search, or its Archive folder, which its agent
          // also checks.
          if (!machine.discoveryRoots.includes(path) && machine.archiveFolder !== path) {
            return FolderOutcome.cases.Failed.make({
              message: `${path} isn't one of ${machineLabel(machine)}'s project folders or its Archive folder.`,
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
      InspectCheckout: ({ machineId, path, worktree }) =>
        machines
          .find(machineId)
          .pipe(Effect.andThen(inspections.inspect({ machineId, path, worktree }))),
      RemoveMachine: ({ machineId }) =>
        Effect.gen(function* () {
          const machine = yield* machines.find(machineId);

          yield* machines.remove(machineId);
          yield* icons.replace({ machineId, icons: [] });
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
      UpdateIntegrations: ({ integrations: settings }) =>
        integrations
          .update(settings)
          .pipe(
            Effect.andThen(
              activity.recordEvent({ _tag: "IntegrationsChanged", integrations: settings }),
            ),
          ),
      SetArchiveFolder: ({ machineId, folder }) =>
        Effect.gen(function* () {
          const machine = yield* machines.find(machineId);
          const trimmed = folder?.trim() ?? null;

          if (
            trimmed !== null &&
            checkArchiveFolder({
              folder: trimmed,
              home: machine.info.homeDirectory,
              roots: machine.discoveryRoots,
            })._tag !== "Valid"
          ) {
            return yield* new InvalidArchiveFolder();
          }

          yield* machines.setArchiveFolder({ machineId, folder: trimmed });
          yield* sessions.reconfigure(machineId);
          yield* feed.invalidate;

          return yield* activity.recordEvent({
            _tag: "ArchiveFolderChanged",
            machineId,
            machineName: machineLabel(machine),
            folder: trimmed,
          });
        }),
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
