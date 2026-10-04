import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { expect, it } from "@effect/vitest";
import { Effect, Layer, SubscriptionRef } from "effect";
import { SqlClient } from "effect/sql";

import { defaultIntegrationSettings } from "@fleetfrog/protocol/domain/t3Code";

import { MachineStore } from "../../machines/machineStore.ts";
import { IntegrationsStore } from "../../settings/integrationsStore.ts";
import { migrations } from "../database.ts";

const before = Object.fromEntries(Object.entries(migrations).filter(([name]) => name < "0009"));

const OldDatabase = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* SqliteMigrator.run({ loader: SqliteMigrator.fromRecord(before) });
    yield* sql`insert into machines ${sql.insert({
      id: "aaaaaaaa-0000-4000-8000-000000000000",
      token_hash: "hash",
      info_json: JSON.stringify({
        hostname: "studio",
        prettyName: null,
        platform: "darwin",
        homeDirectory: "/Users/dev",
        agentVersion: "0.0.0",
        githubCli: { _tag: "Unavailable", reason: "" },
        system: null,
      }),
      discovery_roots_json: '["~/Projects"]',
      paired_at: "2026-09-26T00:00:00.000Z",
    })}`;
    yield* sql`insert into settings ${sql.insert({
      id: 1,
      polling_json: JSON.stringify({
        idleStatusSeconds: 300,
        watchingStatusSeconds: 30,
        discoverySeconds: 1800,
        githubSeconds: 900,
      }),
    })}`;
    yield* SqliteMigrator.run({ loader: SqliteMigrator.fromRecord(migrations) });
  }),
);

it.effect("keeps machines and settings readable, with nothing read from T3 Code yet", () =>
  Effect.gen(function* () {
    const machines = yield* (yield* MachineStore).all;
    const integrations = yield* SubscriptionRef.get((yield* IntegrationsStore).settings);

    expect(machines.map(({ info, t3Code }) => [info.hostname, t3Code])).toEqual([["studio", null]]);
    expect(integrations).toEqual(defaultIntegrationSettings);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(MachineStore.layer, IntegrationsStore.layer).pipe(
        Layer.provide(OldDatabase),
        Layer.provide(SqliteClient.layer({ filename: ":memory:" })),
      ),
    ),
  ),
);
