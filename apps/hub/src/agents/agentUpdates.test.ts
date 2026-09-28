import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Stream, SubscriptionRef } from "effect";
import { SqlClient } from "effect/sql";

import { AgentNotUpdatable } from "@fleetfrog/protocol/dashboard/rpcs";
import { MachineId } from "@fleetfrog/protocol/domain/machine";

import { DashboardPresence } from "../dashboard/dashboardPresence.ts";
import { MachineStore } from "../machines/machineStore.ts";
import { Migrations } from "../persistence/database.ts";
import { IntegrationsStore } from "../settings/integrationsStore.ts";
import { PollingStore } from "../settings/pollingStore.ts";
import { AgentSessions } from "./agentSessions.ts";
import { AgentUpdates } from "./agentUpdates.ts";

import type { AgentCapabilities } from "@fleetfrog/protocol/domain/action";

const studio = MachineId.make("aaaaaaaa-0000-4000-8000-000000000000");

const TestUpdates = AgentUpdates.layer.pipe(
  Layer.provideMerge(AgentSessions.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      MachineStore.layer,
      PollingStore.layer,
      IntegrationsStore.layer,
      DashboardPresence.layer,
    ),
  ),
  Layer.provideMerge(
    Migrations.pipe(Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" }))),
  ),
);

const capabilities = (updatesItself: boolean): AgentCapabilities => ({
  actions: [],
  allowedTiers: ["update"],
  policyReadable: true,
  createsFolders: true,
  updatesItself,
});

/** Pairs the studio and connects its agent on `agentVersion`, returning the commands it receives. */
const connectStudio = Effect.fnUntraced(function* (options: {
  readonly agentVersion: string;
  readonly updatesItself: boolean;
}) {
  const sql = yield* SqlClient.SqlClient;
  const machines = yield* MachineStore;
  const sessions = yield* AgentSessions;

  yield* sql`insert into machines ${sql.insert({
    id: studio,
    token_hash: "hash",
    info_json: "{}",
    discovery_roots_json: "[]",
    paired_at: "2026-09-26T00:00:00.000Z",
  })}`;
  yield* machines.recordConnection({
    machineId: studio,
    info: {
      hostname: "studio",
      prettyName: null,
      platform: "darwin",
      homeDirectory: "/Users/dev",
      agentVersion: options.agentVersion,
      agentRuntime: "rust",
      githubCli: { _tag: "Unavailable", reason: "" },
      system: null,
    },
  });

  return yield* sessions.connect({
    machineId: studio,
    capabilities: capabilities(options.updatesItself),
  });
});

describe("AgentUpdates", () => {
  it.effect("sends the hub's version once and fails an agent that returns on its old one", () =>
    Effect.gen(function* () {
      const updates = yield* AgentUpdates;
      const commands = yield* connectStudio({ agentVersion: "0.0.1", updatesItself: true });

      yield* updates.start(studio);

      const second = yield* Effect.flip(updates.start(studio));
      const sent = yield* commands.pipe(Stream.take(2), Stream.runCollect);

      expect(sent.map((command) => command._tag)).toEqual(["Configure", "Update"]);
      expect(sent[1]).toMatchObject({ version: updates.targetVersion });
      expect(second).toEqual(new AgentNotUpdatable({ machineId: studio }));
      expect((yield* SubscriptionRef.get(updates.updates)).get(studio)?._tag).toBe("Updating");

      yield* updates.connected({ machineId: studio, agentVersion: "0.0.1" });

      expect((yield* SubscriptionRef.get(updates.updates)).get(studio)).toEqual({
        _tag: "Failed",
        version: updates.targetVersion,
        message: "The agent reconnected on 0.0.1 before the update finished.",
      });

      yield* updates.connected({ machineId: studio, agentVersion: updates.targetVersion });

      expect((yield* SubscriptionRef.get(updates.updates)).has(studio)).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(TestUpdates)),
  );

  it.effect("refuses an agent built from source", () =>
    Effect.gen(function* () {
      const updates = yield* AgentUpdates;

      yield* connectStudio({ agentVersion: "0.0.1", updatesItself: false }).pipe(Effect.asVoid);

      const refused = yield* Effect.flip(updates.start(studio));

      expect(refused).toEqual(new AgentNotUpdatable({ machineId: studio }));
      expect((yield* SubscriptionRef.get(updates.updates)).size).toBe(0);
    }).pipe(Effect.scoped, Effect.provide(TestUpdates)),
  );
});
