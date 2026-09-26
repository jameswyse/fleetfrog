import { MachineNotFound } from "@fleetfrog/protocol/dashboard/rpcs";
import { MachineId, MachineInfo } from "@fleetfrog/protocol/domain/machine";
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";

import { JsonColumn } from "../persistence/database.ts";

import type { SqlError } from "effect/unstable/sql";

const Timestamp = Schema.DateTimeUtcFromString;

const MachineRow = Schema.Struct({
  id: MachineId,
  info_json: JsonColumn(MachineInfo),
  custom_name: Schema.NullOr(Schema.String),
  discovery_roots_json: JsonColumn(Schema.Array(Schema.String)),
  paired_at: Timestamp,
  last_seen_at: Schema.NullOr(Timestamp),
  last_discovery_at: Schema.NullOr(Timestamp),
  last_status_at: Schema.NullOr(Timestamp),
});

/** A paired machine as stored. Connection state lives with the agent sessions, not here. */
export interface MachineRecord {
  readonly id: MachineId;
  readonly info: MachineInfo;
  readonly customName: string | null;
  readonly discoveryRoots: ReadonlyArray<string>;
  readonly pairedAt: DateTime.Utc;
  readonly lastSeenAt: DateTime.Utc | null;
  readonly lastDiscoveryAt: DateTime.Utc | null;
  readonly lastStatusAt: DateTime.Utc | null;
}

const decodeRows = Schema.decodeUnknownEffect(Schema.Array(MachineRow));
const encodeInfo = Schema.encodeSync(JsonColumn(MachineInfo));
const encodeRoots = Schema.encodeSync(JsonColumn(Schema.Array(Schema.String)));

export class MachineStore extends Context.Service<
  MachineStore,
  {
    readonly all: Effect.Effect<ReadonlyArray<MachineRecord>>;
    readonly find: (id: MachineId) => Effect.Effect<MachineRecord, MachineNotFound>;
    readonly findIdByTokenHash: (tokenHash: string) => Effect.Effect<Option.Option<MachineId>>;
    readonly create: (machine: {
      readonly id: MachineId;
      readonly tokenHash: string;
      readonly info: MachineInfo;
      readonly discoveryRoots: ReadonlyArray<string>;
    }) => Effect.Effect<void>;
    readonly recordConnection: (connection: {
      readonly machineId: MachineId;
      readonly info: MachineInfo;
    }) => Effect.Effect<void>;
    readonly recordSeen: (id: MachineId) => Effect.Effect<void>;
    readonly recordScan: (scan: {
      readonly machineId: MachineId;
      readonly kind: "discovery" | "status";
      readonly completedAt: DateTime.Utc;
    }) => Effect.Effect<void>;
    readonly rename: (rename: {
      readonly machineId: MachineId;
      readonly customName: string | null;
    }) => Effect.Effect<void, MachineNotFound>;
    readonly setDiscoveryRoots: (update: {
      readonly machineId: MachineId;
      readonly roots: ReadonlyArray<string>;
    }) => Effect.Effect<void, MachineNotFound>;
    readonly remove: (id: MachineId) => Effect.Effect<void, MachineNotFound>;
  }
>()("fleetfrog/MachineStore") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

      const toRecords = (rows: ReadonlyArray<unknown>) =>
        decodeRows(rows).pipe(
          Effect.map((decoded) =>
            decoded.map((row): MachineRecord => ({
              id: row.id,
              info: row.info_json,
              customName: row.custom_name,
              discoveryRoots: row.discovery_roots_json,
              pairedAt: row.paired_at,
              lastSeenAt: row.last_seen_at,
              lastDiscoveryAt: row.last_discovery_at,
              lastStatusAt: row.last_status_at,
            })),
          ),
        );

      /** Runs an update that must touch exactly one machine and returns its id. */
      const updateOne = (
        machineId: MachineId,
        statement: Effect.Effect<ReadonlyArray<unknown>, SqlError.SqlError>,
      ) =>
        statement.pipe(
          Effect.orDie,
          Effect.flatMap((rows) =>
            rows.length === 0 ? Effect.fail(new MachineNotFound({ machineId })) : Effect.void,
          ),
        );

      return {
        all: sql`select * from machines order by paired_at`.pipe(
          Effect.flatMap(toRecords),
          Effect.orDie,
        ),
        find: (machineId) =>
          sql`select * from machines where id = ${machineId}`.pipe(
            Effect.flatMap(toRecords),
            Effect.orDie,
            Effect.flatMap(([record]) =>
              record === undefined
                ? Effect.fail(new MachineNotFound({ machineId }))
                : Effect.succeed(record),
            ),
          ),
        findIdByTokenHash: (tokenHash) =>
          sql<{ id: string }>`select id from machines where token_hash = ${tokenHash}`.pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: MachineId }))),
            ),
            Effect.map((rows) => Option.fromNullishOr(rows[0]?.id)),
            Effect.orDie,
          ),
        create: (machine) =>
          Effect.gen(function* () {
            const pairedAt = yield* now;

            yield* sql`insert into machines ${sql.insert({
              id: machine.id,
              token_hash: machine.tokenHash,
              info_json: encodeInfo(machine.info),
              discovery_roots_json: encodeRoots(machine.discoveryRoots),
              paired_at: pairedAt,
            })}`;
          }).pipe(Effect.orDie),
        recordConnection: ({ machineId, info }) =>
          Effect.gen(function* () {
            yield* sql`update machines set info_json = ${encodeInfo(info)}, last_seen_at = ${yield* now} where id = ${machineId}`;
          }).pipe(Effect.orDie),
        recordSeen: (id) =>
          Effect.gen(function* () {
            yield* sql`update machines set last_seen_at = ${yield* now} where id = ${id}`;
          }).pipe(Effect.orDie),
        recordScan: ({ machineId, kind, completedAt }) => {
          const at = DateTime.formatIso(completedAt);

          return (
            kind === "discovery"
              ? sql`update machines set last_discovery_at = ${at}, last_status_at = ${at} where id = ${machineId}`
              : sql`update machines set last_status_at = ${at} where id = ${machineId}`
          ).pipe(Effect.asVoid, Effect.orDie);
        },
        rename: ({ machineId, customName }) =>
          updateOne(
            machineId,
            sql`update machines set custom_name = ${customName} where id = ${machineId} returning id`,
          ),
        setDiscoveryRoots: ({ machineId, roots }) =>
          updateOne(
            machineId,
            sql`update machines set discovery_roots_json = ${encodeRoots(roots)} where id = ${machineId} returning id`,
          ),
        remove: (machineId) =>
          updateOne(machineId, sql`delete from machines where id = ${machineId} returning id`),
      };
    }),
  );
}
