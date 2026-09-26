import { Effect, Stream } from "effect";

import { AgentRpcs, CurrentMachine, ScanReport } from "@fleetfrog/protocol/agent/rpcs";

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

    return {
      Connect: ({ info }) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const { id } = yield* CurrentMachine;

            yield* machines.recordConnection({ machineId: id, info });
            yield* feed.invalidate;

            return yield* sessions.connect(id);
          }),
        ),
      Report: ({ report }) =>
        Effect.gen(function* () {
          const { id } = yield* CurrentMachine;

          yield* ScanReport.match(report, {
            Discovery: ({ checkouts: inventory, completedAt }) =>
              checkouts
                .replace({ machineId: id, checkouts: inventory })
                .pipe(
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
    };
  }),
);
