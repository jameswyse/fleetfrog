import { Effect, Stream } from "effect";

import { AgentRpcs, CurrentMachine, ScanReport } from "@fleetfrog/protocol/agent/rpcs";

import { ActionDispatcher } from "../actions/actionDispatcher.ts";
import { CheckoutStore } from "../catalogue/checkoutStore.ts";
import { FleetFeed } from "../catalogue/fleetFeed.ts";
import { MachineStore } from "../machines/machineStore.ts";
import { AgentSessions } from "./agentSessions.ts";

export const AgentHandlers = AgentRpcs.toLayer(
  Effect.gen(function* () {
    const sessions = yield* AgentSessions;
    const machines = yield* MachineStore;
    const checkouts = yield* CheckoutStore;
    const feed = yield* FleetFeed;
    const dispatcher = yield* ActionDispatcher;

    return {
      Connect: ({ info, capabilities }) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const { id } = yield* CurrentMachine;

            yield* machines.recordConnection({ machineId: id, info });
            yield* feed.invalidate;

            return yield* sessions.connect({ machineId: id, capabilities });
          }),
        ),
      Report: ({ report }) =>
        Effect.gen(function* () {
          const { id } = yield* CurrentMachine;

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
            Status: ({ changed, removedPaths, completedAt }) =>
              checkouts
                .apply({ machineId: id, changed, removedPaths })
                .pipe(
                  Effect.andThen(
                    machines.recordScan({ machineId: id, kind: "status", completedAt }),
                  ),
                ),
          });
          yield* feed.invalidate;
        }),
      Heartbeat: () => CurrentMachine.use(({ id }) => sessions.heartbeat(id)),
      Advertise: ({ capabilities }) =>
        CurrentMachine.use(({ id }) => sessions.advertise({ machineId: id, capabilities })),
      ReportAction: ({ runId, update }) =>
        CurrentMachine.use(({ id }) => dispatcher.receive({ machineId: id, runId, update })),
    };
  }),
);
