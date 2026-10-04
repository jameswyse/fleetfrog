import { Effect, Schema, Stream } from "effect";

import { AgentRpcs, CurrentMachine, ScanReport } from "@fleetfrog/protocol/agent/rpcs";
import { ActionOutcome, ActionUpdate } from "@fleetfrog/protocol/domain/action";

import { ActionDispatcher } from "../actions/actionDispatcher.ts";
import { CheckoutStore } from "../catalogue/checkoutStore.ts";
import { FleetFeed } from "../catalogue/fleetFeed.ts";
import { ProjectIconStore } from "../catalogue/projectIconStore.ts";
import { MachineStore } from "../machines/machineStore.ts";
import { AgentSessions } from "./agentSessions.ts";
import { AgentUpdates } from "./agentUpdates.ts";
import { FolderRequests } from "./folderRequests.ts";
import { InspectionRequests } from "./inspectionRequests.ts";

const isScanReport = Schema.is(ScanReport);
const isActionUpdate = Schema.is(ActionUpdate);

export const AgentHandlers = AgentRpcs.toLayer(
  Effect.gen(function* () {
    const sessions = yield* AgentSessions;
    const machines = yield* MachineStore;
    const checkouts = yield* CheckoutStore;
    const icons = yield* ProjectIconStore;
    const feed = yield* FleetFeed;
    const dispatcher = yield* ActionDispatcher;
    const folders = yield* FolderRequests;
    const inspections = yield* InspectionRequests;
    const updates = yield* AgentUpdates;

    return {
      Connect: ({ info, capabilities }) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const { id } = yield* CurrentMachine;

            yield* machines.recordConnection({ machineId: id, info });
            yield* updates.connected({ machineId: id, agentVersion: info.agentVersion });
            yield* feed.invalidate;

            return yield* sessions.connect({ machineId: id, capabilities });
          }),
        ),
      Report: ({ report }) =>
        Effect.gen(function* () {
          const { id } = yield* CurrentMachine;

          if (!isScanReport(report)) {
            return yield* Effect.logWarning(`Ignored a report this hub can't read: ${report._tag}`);
          }

          yield* ScanReport.match(report, {
            Discovery: ({ checkouts: inventory, roots, completedAt }) =>
              checkouts
                .replace({ machineId: id, checkouts: inventory })
                .pipe(
                  Effect.andThen(machines.recordRootStatuses({ machineId: id, roots })),
                  Effect.andThen(
                    machines.recordScan({ machineId: id, kind: "discovery", completedAt }),
                  ),
                ),
            Trash: ({ items }) => machines.recordTrash({ machineId: id, items }),
            T3Code: ({ status }) => machines.recordT3Code({ machineId: id, status }),
            ProjectIcons: ({ icons: files }) => icons.replace({ machineId: id, icons: files }),
            Status: ({ changed, removedPaths, completedAt }) =>
              checkouts
                .apply({ machineId: id, changed, removedPaths })
                .pipe(
                  Effect.andThen(
                    machines.recordScan({ machineId: id, kind: "status", completedAt }),
                  ),
                ),
          });

          return yield* feed.invalidate;
        }),
      Heartbeat: () => CurrentMachine.use(({ id }) => sessions.heartbeat(id)),
      Advertise: ({ capabilities }) =>
        CurrentMachine.use(({ id }) => sessions.advertise({ machineId: id, capabilities })),
      ReportUsage: ({ usage }) =>
        CurrentMachine.use(({ id }) =>
          machines.recordUsage({ machineId: id, usage }).pipe(Effect.andThen(feed.invalidate)),
        ),
      ReportAction: ({ runId, update }) =>
        CurrentMachine.use(({ id }) => {
          if (isActionUpdate(update)) {
            return dispatcher.receive({ machineId: id, runId, update });
          }

          return update._tag === "Finished" && "output" in update
            ? dispatcher.receive({
                machineId: id,
                runId,
                update: ActionUpdate.cases.Finished.make({
                  outcome: ActionOutcome.cases.Failed.make({
                    message: "The agent reported an outcome this hub can't read. Update the hub.",
                  }),
                  output: update.output,
                }),
              })
            : Effect.logWarning(`Ignored an action update this hub can't read: ${update._tag}`);
        }),
      ReportFolder: ({ requestId, outcome }) =>
        CurrentMachine.use(({ id }) => folders.answer({ machineId: id, requestId, outcome })),
      ReportInspection: ({ requestId, result }) =>
        CurrentMachine.use(({ id }) => inspections.answer({ machineId: id, requestId, result })),
      TargetVersion: () => Effect.succeed({ version: updates.targetVersion }),
      ReportUpdateFailure: ({ version, message }) =>
        CurrentMachine.use(({ id }) => updates.fail({ machineId: id, version, message })),
    };
  }),
);
