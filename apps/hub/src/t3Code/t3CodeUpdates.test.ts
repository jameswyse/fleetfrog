import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, Layer, Stream, SubscriptionRef } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";

import { T3CodeNotUpdatable } from "@fleetfrog/protocol/dashboard/rpcs";
import { MachineId } from "@fleetfrog/protocol/domain/machine";
import { supportedT3CodeSchema } from "@fleetfrog/protocol/domain/t3Code";

import { AgentSessions } from "../agents/agentSessions.ts";
import { DashboardPresence } from "../dashboard/dashboardPresence.ts";
import { MachineStore } from "../machines/machineStore.ts";
import { Migrations } from "../persistence/database.ts";
import { CleanupStore } from "../settings/cleanupStore.ts";
import { IntegrationsStore } from "../settings/integrationsStore.ts";
import { PollingStore } from "../settings/pollingStore.ts";
import { T3CodeReleaseFeed } from "./t3CodeReleaseFeed.ts";
import { T3CodeUpdates } from "./t3CodeUpdates.ts";

import type { T3CodeStatus } from "@fleetfrog/protocol/domain/t3Code";

const mini = MachineId.make("bbbbbbbb-0000-4000-8000-000000000000");
const latest = "0.0.46-nightly.20261012.3021";
const outdated = "0.0.46-nightly.20261007.2787";

const TestUpdates = T3CodeUpdates.layer.pipe(
  Layer.provideMerge(AgentSessions.layer),
  Layer.provideMerge(T3CodeReleaseFeed.fixed({ stable: null, nightly: latest, preview: null })),
  Layer.provideMerge(
    Layer.mergeAll(
      MachineStore.layer,
      PollingStore.layer,
      CleanupStore.layer,
      IntegrationsStore.layer,
      DashboardPresence.layer,
    ),
  ),
  Layer.provideMerge(
    Migrations.pipe(Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" }))),
  ),
);

function t3Code(server: {
  readonly version: string;
  readonly serviceManaged: boolean;
  readonly startedAt: DateTime.Utc;
}): T3CodeStatus {
  return {
    database: "/Users/dev/.t3/userdata/statev2.sqlite",
    reading: {
      _tag: "Read",
      schema: supportedT3CodeSchema,
      projects: [],
      threads: [],
      threadCount: 0,
      unreadRecords: 0,
    },
    server: { ...server, port: 3773 },
    providers: [],
  };
}

const earlier = DateTime.now.pipe(Effect.map(DateTime.subtract({ hours: 1 })));

const connectMini = Effect.fnUntraced(function* (
  serviceManaged: boolean,
  updatesT3CodeApp: boolean,
) {
  const sql = yield* SqlClient.SqlClient;
  const machines = yield* MachineStore;
  const sessions = yield* AgentSessions;

  yield* sql`insert into machines ${sql.insert({
    id: mini,
    token_hash: "hash",
    info_json: "{}",
    discovery_roots_json: "[]",
    paired_at: "2026-09-26T00:00:00.000Z",
  })}`;
  yield* machines.recordConnection({
    machineId: mini,
    info: {
      hostname: "mini",
      prettyName: null,
      platform: "darwin",
      homeDirectory: "/Users/dev",
      agentVersion: "0.9.0",
      agentRuntime: "rust",
      githubCli: { _tag: "Unavailable", reason: "" },
      system: null,
    },
  });
  yield* machines.recordT3Code({
    machineId: mini,
    status: t3Code({ version: outdated, serviceManaged, startedAt: yield* earlier }),
  });

  return yield* sessions.connect({
    machineId: mini,
    capabilities: {
      actions: [],
      allowedTiers: ["t3code"],
      policyReadable: true,
      createsFolders: true,
      updatesItself: true,
      updatesT3Code: true,
      updatesT3CodeApp,
    },
  });
});

describe("T3CodeUpdates", () => {
  it.effect("sends the newest release once and waits for a scan that shows it running", () =>
    Effect.gen(function* () {
      const updates = yield* T3CodeUpdates;
      const commands = yield* connectMini(true, true);

      yield* updates.start(mini);

      const second = yield* Effect.flip(updates.start(mini));
      const sent = yield* commands.pipe(Stream.take(2), Stream.runCollect);

      expect(sent.map((command) => command._tag)).toStrictEqual(["Configure", "UpdateT3Code"]);
      expect(sent[1]).toMatchObject({ version: latest });
      expect(second).toStrictEqual(new T3CodeNotUpdatable({ machineId: mini }));

      yield* updates.finish({ machineId: mini, version: latest, outcome: { _tag: "Updated" } });

      expect((yield* SubscriptionRef.get(updates.updates)).get(mini)?._tag).toBe("Updating");

      yield* updates.reported({
        machineId: mini,
        status: t3Code({ version: latest, serviceManaged: true, startedAt: yield* DateTime.now }),
      });

      expect((yield* SubscriptionRef.get(updates.updates)).has(mini)).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(TestUpdates)),
  );

  it.effect(
    "follows the version a desktop app reports installing instead of the one asked for",
    () =>
      Effect.gen(function* () {
        const updates = yield* T3CodeUpdates;
        const offered = "0.0.46-nightly.20261011.2980";

        yield* connectMini(false, true).pipe(Effect.asVoid);
        yield* updates.start(mini);
        yield* updates.finish({ machineId: mini, version: offered, outcome: { _tag: "Updated" } });

        expect((yield* SubscriptionRef.get(updates.updates)).get(mini)).toMatchObject({
          _tag: "Updating",
          version: offered,
        });

        yield* updates.reported({
          machineId: mini,
          status: t3Code({
            version: offered,
            serviceManaged: false,
            startedAt: DateTime.add(yield* DateTime.now, { seconds: 1 }),
          }),
        });

        expect((yield* SubscriptionRef.get(updates.updates)).has(mini)).toBe(false);
      }).pipe(Effect.scoped, Effect.provide(TestUpdates)),
  );

  it.effect("clears an update whose relaunch was scanned before the agent reported it", () =>
    Effect.gen(function* () {
      const updates = yield* T3CodeUpdates;
      const machines = yield* MachineStore;
      const offered = "0.0.46-nightly.20261011.2980";

      yield* connectMini(false, true).pipe(Effect.asVoid);
      yield* updates.start(mini);

      const relaunched = t3Code({
        version: offered,
        serviceManaged: false,
        startedAt: DateTime.add(yield* DateTime.now, { seconds: 1 }),
      });

      yield* machines.recordT3Code({ machineId: mini, status: relaunched });
      yield* updates.reported({ machineId: mini, status: relaunched });

      expect((yield* SubscriptionRef.get(updates.updates)).get(mini)?._tag).toBe("Failed");

      yield* updates.finish({ machineId: mini, version: offered, outcome: { _tag: "Updated" } });

      expect((yield* SubscriptionRef.get(updates.updates)).has(mini)).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(TestUpdates)),
  );

  it.effect("fails an update when T3 Code restarts on an older version", () =>
    Effect.gen(function* () {
      const updates = yield* T3CodeUpdates;

      yield* connectMini(true, true).pipe(Effect.asVoid);
      yield* updates.start(mini);
      yield* updates.reported({
        machineId: mini,
        status: t3Code({ version: outdated, serviceManaged: true, startedAt: yield* earlier }),
      });

      expect((yield* SubscriptionRef.get(updates.updates)).get(mini)?._tag).toBe("Updating");

      yield* updates.reported({
        machineId: mini,
        status: t3Code({
          version: outdated,
          serviceManaged: true,
          startedAt: DateTime.add(yield* DateTime.now, { seconds: 1 }),
        }),
      });

      expect((yield* SubscriptionRef.get(updates.updates)).get(mini)).toStrictEqual({
        _tag: "Failed",
        version: latest,
        message: `T3 Code restarted on ${outdated} instead.`,
      });
    }).pipe(Effect.scoped, Effect.provide(TestUpdates)),
  );

  it.effect("fails an update that T3 Code never confirms within 35 minutes", () =>
    Effect.gen(function* () {
      const updates = yield* T3CodeUpdates;

      yield* connectMini(true, true).pipe(Effect.asVoid);
      yield* updates.start(mini);
      yield* TestClock.adjust("34 minutes");

      expect((yield* SubscriptionRef.get(updates.updates)).get(mini)?._tag).toBe("Updating");

      yield* TestClock.adjust("2 minutes");

      expect((yield* SubscriptionRef.get(updates.updates)).get(mini)).toStrictEqual({
        _tag: "Failed",
        version: latest,
        message: "T3 Code didn't report the new version within 35 minutes.",
      });
    }).pipe(Effect.scoped, Effect.provide(TestUpdates)),
  );

  it.effect("refuses a desktop app when the agent can't update one", () =>
    Effect.gen(function* () {
      const updates = yield* T3CodeUpdates;

      yield* connectMini(false, false).pipe(Effect.asVoid);

      const refused = yield* Effect.flip(updates.start(mini));

      expect(refused).toStrictEqual(new T3CodeNotUpdatable({ machineId: mini }));
      expect((yield* SubscriptionRef.get(updates.updates)).size).toBe(0);
    }).pipe(Effect.scoped, Effect.provide(TestUpdates)),
  );
});
