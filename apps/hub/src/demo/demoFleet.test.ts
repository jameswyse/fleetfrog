import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Schedule, Stream } from "effect";

import { machineLabel } from "@fleetfrog/protocol/domain/fleet";
import { repositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

import { ActionDispatcher } from "../actions/actionDispatcher.ts";
import { ActivityFeed } from "../activity/activityFeed.ts";
import { ActivityStore } from "../activity/activityStore.ts";
import { AgentSessions } from "../agents/agentSessions.ts";
import { AgentUpdates } from "../agents/agentUpdates.ts";
import { FolderRequests } from "../agents/folderRequests.ts";
import { InspectionRequests } from "../agents/inspectionRequests.ts";
import { CheckoutStore } from "../catalogue/checkoutStore.ts";
import { FleetFeed } from "../catalogue/fleetFeed.ts";
import { ProjectIconStore } from "../catalogue/projectIconStore.ts";
import { DashboardPresence } from "../dashboard/dashboardPresence.ts";
import { HubConfig } from "../hubConfig.ts";
import { MachineStore } from "../machines/machineStore.ts";
import { Database } from "../persistence/database.ts";
import { IntegrationsStore } from "../settings/integrationsStore.ts";
import { PollingStore } from "../settings/pollingStore.ts";
import { ProjectLayoutStore } from "../settings/projectLayoutStore.ts";
import { DemoFleet } from "./demoFleet.ts";
import { demoMachines } from "./demoFleetData.ts";

import type { Fleet, MachineCheckout } from "@fleetfrog/protocol/domain/fleet";

const config = Layer.succeed(HubConfig)({
  dataDirectory: "unused",
  host: null,
  dashboardPort: 0,
  agentPort: 0,
  agentTls: "none",
  agentUrl: null,
  tailscaleSocket: null,
  dashboardSocket: null,
  webRoot: null,
  authModeOverride: null,
  demo: true,
});

const DemoHub = DemoFleet.pipe(
  Layer.provideMerge(ActionDispatcher.layer),
  Layer.provide(FolderRequests.layer),
  Layer.provide(InspectionRequests.layer),
  Layer.provideMerge(FleetFeed.layer),
  Layer.provideMerge(ActivityFeed.layer),
  Layer.provideMerge(AgentUpdates.layer),
  Layer.provideMerge(AgentSessions.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      MachineStore.layer,
      CheckoutStore.layer,
      ActivityStore.layer,
      PollingStore.layer,
      IntegrationsStore.layer,
      ProjectLayoutStore.layer,
      ProjectIconStore.layer,
      DashboardPresence.layer,
    ),
  ),
  Layer.provideMerge(Database),
  Layer.provideMerge(config),
);

const fleetWhere = (ready: (fleet: Fleet) => boolean) =>
  FleetFeed.use(({ watch }) =>
    watch.pipe(Stream.filter(ready), Stream.runHead, Effect.map(Option.getOrThrow)),
  ).pipe(Effect.timeout("10 seconds"));

const fullyReported = (fleet: Fleet) =>
  fleet.machines.length === demoMachines.length &&
  fleet.machines.every(
    (machine) => machine.connection._tag === "Online" && machine.lastDiscoveryAt !== null,
  ) &&
  fleet.repositories.some(({ icon }) => icon !== null);

function upstreamOf({ checkout }: MachineCheckout) {
  const { status } = checkout;

  return status._tag === "Read" && status.git.head._tag === "Branch"
    ? {
        upstream: status.git.head.upstream,
        changed: status.git.changed.total,
        operation: status.git.operation,
      }
    : null;
}

function find(fleet: Fleet, matches: (entry: MachineCheckout) => boolean): MachineCheckout {
  const found = fleet.repositories.flatMap(({ checkouts }) => checkouts).find(matches);

  if (found === undefined) {
    throw new Error("The demo fleet has no checkout in that state.");
  }

  return found;
}

function current(fleet: Fleet, target: MachineCheckout): MachineCheckout | undefined {
  return fleet.repositories
    .flatMap(({ checkouts }) => checkouts)
    .find(
      ({ machineId, checkout }) =>
        machineId === target.machineId &&
        checkout.path === target.checkout.path &&
        repositoryKey(checkout.identity) === repositoryKey(target.checkout.identity),
    );
}

const pull = Effect.fn("pull")(function* (target: MachineCheckout) {
  const dispatcher = yield* ActionDispatcher;
  const activity = yield* ActivityFeed;

  const batchId = yield* dispatcher.start(
    {
      _tag: "Pull",
      scope: { _tag: "Checkout", machineId: target.machineId, path: target.checkout.path },
    },
    null,
  );

  return yield* activity.watchBatch(batchId).pipe(
    Stream.map(({ runs }) => runs[0]?.run.state),
    Stream.filter((state) => state?._tag === "Finished"),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
    Effect.timeout("10 seconds"),
  );
});

describe("DemoFleet", () => {
  it.live("reports every demo machine and its projects through the agent protocol", () =>
    Effect.gen(function* () {
      const fleet = yield* fleetWhere(fullyReported);

      expect(fleet.machines.map(machineLabel)).toEqual(
        demoMachines.map((machine) => machine.prettyName ?? machine.hostname),
      );
      expect(fleet.repositories.some(({ icon }) => icon === null)).toBe(true);
      expect(fleet.archive.length).toBeGreaterThan(0);

      const images = fleet.repositories.flatMap(({ icon }) =>
        icon?._tag === "Image" ? [icon.id] : [],
      );

      expect(images.length).toBeGreaterThan(0);

      const stored = yield* ProjectIconStore.use((store) =>
        Effect.forEach(images, store.find).pipe(
          Effect.filterOrFail((found) => found.every(Option.isSome)),
          Effect.retry(Schedule.spaced("20 millis")),
          Effect.timeout("5 seconds"),
        ),
      );

      expect(stored).toHaveLength(images.length);
    }).pipe(Effect.provide(DemoHub)),
  );

  it.live("fast-forwards a checkout that is behind and refuses one with changes", () =>
    Effect.gen(function* () {
      const fleet = yield* fleetWhere(fullyReported);

      const behind = find(fleet, (entry) => {
        const state = upstreamOf(entry);

        return (
          state !== null &&
          state.changed === 0 &&
          (state.upstream?.behind ?? 0) > 0 &&
          (state.upstream?.ahead ?? 0) === 0
        );
      });

      const commits = upstreamOf(behind)?.upstream?.behind;

      expect(yield* pull(behind)).toMatchObject({
        outcome: { _tag: "Succeeded", result: { _tag: "FastForwarded", commits } },
      });

      const after = yield* fleetWhere((next) => {
        const entry = current(next, behind);

        return entry !== undefined && upstreamOf(entry)?.upstream?.behind === 0;
      });

      expect(current(after, behind)).toBeDefined();

      const changed = find(after, (entry) => {
        const state = upstreamOf(entry);

        return state !== null && state.operation === null && state.changed > 0;
      });

      expect(yield* pull(changed)).toMatchObject({
        outcome: {
          _tag: "Skipped",
          reason: { _tag: "UncommittedChanges", files: upstreamOf(changed)?.changed },
        },
      });
    }).pipe(Effect.provide(DemoHub)),
  );
});
