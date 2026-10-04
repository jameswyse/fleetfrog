import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql";

import { BatchNotFound } from "@fleetfrog/protocol/dashboard/rpcs";
import {
  ActionKind,
  ActionOutcome,
  ActionRequest,
  OutcomeKind,
} from "@fleetfrog/protocol/domain/action";
import { Actor, BatchId, BatchScope, HubEvent, RunId } from "@fleetfrog/protocol/domain/activity";
import { MachineId } from "@fleetfrog/protocol/domain/machine";
import { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

import { JsonColumn } from "../persistence/database.ts";

import type {
  ActionBatch,
  ActionRun,
  ActivityEntry,
  ActivityFilter,
  ActivityPage,
  BatchDetail,
  RunCounts,
  RunState,
} from "@fleetfrog/protocol/domain/activity";

const Timestamp = Schema.DateTimeUtcFromString;
const StatusColumn = Schema.Union([Schema.Literals(["Queued", "Running"]), OutcomeKind]);

const RunRow = Schema.Struct({
  id: RunId,
  batch_id: BatchId,
  machine_id: MachineId,
  machine_name: Schema.String,
  repository_key: RepositoryKey,
  repository_name: Schema.String,
  path: Schema.String,
  request_json: JsonColumn(ActionRequest),
  status: StatusColumn,
  progress: Schema.NullOr(Schema.String),
  outcome_json: Schema.NullOr(JsonColumn(ActionOutcome)),
  output_json: JsonColumn(Schema.Array(Schema.String)),
  started_at: Schema.NullOr(Timestamp),
  finished_at: Schema.NullOr(Timestamp),
});
type RunRow = typeof RunRow.Type;

const BatchRow = Schema.Struct({
  id: BatchId,
  kind: ActionKind,
  scope_json: JsonColumn(BatchScope),
  requested_at: Timestamp,
  finished_at: Schema.NullOr(Timestamp),
  requested_by_json: Schema.NullOr(JsonColumn(Actor)),
});
type BatchRow = typeof BatchRow.Type;

const CountRow = Schema.Struct({ batch_id: BatchId, status: StatusColumn, count: Schema.Int });
const MachineNameRow = Schema.Struct({ batch_id: BatchId, machine_name: Schema.String });

const EventRow = Schema.Struct({
  at: Timestamp,
  event_json: JsonColumn(HubEvent),
  actor_json: Schema.NullOr(JsonColumn(Actor)),
});

const RunTargetRow = Schema.Struct({ id: RunId, machine_id: MachineId });

const decodeRuns = Schema.decodeUnknownEffect(Schema.Array(RunRow));
const decodeBatches = Schema.decodeUnknownEffect(Schema.Array(BatchRow));
const decodeCounts = Schema.decodeUnknownEffect(Schema.Array(CountRow));
const decodeMachineNames = Schema.decodeUnknownEffect(Schema.Array(MachineNameRow));
const decodeEvents = Schema.decodeUnknownEffect(Schema.Array(EventRow));
const decodeTargets = Schema.decodeUnknownEffect(Schema.Array(RunTargetRow));
const encodeRequest = Schema.encodeSync(JsonColumn(ActionRequest));
const encodeOutcome = Schema.encodeSync(JsonColumn(ActionOutcome));
const encodeOutput = Schema.encodeSync(JsonColumn(Schema.Array(Schema.String)));
const encodeScope = Schema.encodeSync(JsonColumn(BatchScope));
const encodeActor = Schema.encodeSync(JsonColumn(Actor));
const encodeEvent = Schema.encodeSync(JsonColumn(HubEvent));

const activeStatuses = ["Queued", "Running"];

function runState(row: RunRow): RunState {
  if (row.outcome_json !== null && row.finished_at !== null) {
    return {
      _tag: "Finished",
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      outcome: row.outcome_json,
    };
  }

  return row.status === "Running" && row.started_at !== null
    ? { _tag: "Running", startedAt: row.started_at, progress: row.progress }
    : { _tag: "Queued" };
}

function toRun(row: RunRow): ActionRun {
  return {
    id: row.id,
    batchId: row.batch_id,
    machineId: row.machine_id,
    machineName: row.machine_name,
    repositoryKey: row.repository_key,
    repositoryName: row.repository_name,
    path: row.path,
    request: row.request_json,
    state: runState(row),
  };
}

const noRuns: RunCounts = {
  Queued: 0,
  Running: 0,
  Succeeded: 0,
  Failed: 0,
  Skipped: 0,
  Cancelled: 0,
  Interrupted: 0,
  MachineOffline: 0,
};

export interface NewRun {
  readonly id: RunId;
  readonly machineId: MachineId;
  readonly machineName: string;
  readonly repositoryKey: RepositoryKey;
  readonly repositoryName: string;
  readonly path: string;
  readonly request: ActionRequest;
  readonly outcome: ActionOutcome | null;
}

export interface UnfinishedRun {
  readonly runId: RunId;
  readonly machineId: MachineId;
}

export class ActivityStore extends Context.Service<
  ActivityStore,
  {
    readonly createBatch: (batch: {
      readonly id: BatchId;
      readonly kind: ActionKind;
      readonly scope: BatchScope;
      readonly requestedAt: DateTime.Utc;
      readonly requestedBy: Actor;
      readonly runs: ReadonlyArray<NewRun>;
    }) => Effect.Effect<void>;
    readonly markStarted: (
      run: UnfinishedRun & { readonly at: DateTime.Utc },
    ) => Effect.Effect<boolean>;
    readonly markProgress: (
      run: UnfinishedRun & { readonly line: string },
    ) => Effect.Effect<boolean>;
    readonly markFinished: (
      run: UnfinishedRun & {
        readonly outcome: ActionOutcome;
        readonly output: ReadonlyArray<string>;
        readonly at: DateTime.Utc;
      },
    ) => Effect.Effect<boolean>;
    readonly unfinished: (
      within: { readonly _tag: "All" } | { readonly _tag: "Batch"; readonly batchId: BatchId },
    ) => Effect.Effect<ReadonlyArray<UnfinishedRun>>;
    readonly activeBatches: Effect.Effect<ReadonlyArray<ActionBatch>>;
    readonly activeRuns: Effect.Effect<ReadonlyArray<ActionRun>>;
    readonly latestRuns: Effect.Effect<ReadonlyArray<ActionRun>>;
    readonly activity: (query: {
      readonly filter: ActivityFilter;
      readonly limit: number;
    }) => Effect.Effect<ActivityPage>;
    readonly batch: (batchId: BatchId) => Effect.Effect<BatchDetail, BatchNotFound>;
    readonly recordEvent: (event: HubEvent, by: Actor) => Effect.Effect<void>;
    readonly prune: (cutoff: DateTime.Utc) => Effect.Effect<void>;
  }
>()("fleetfrog/ActivityStore") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const summarise = Effect.fnUntraced(function* (rows: ReadonlyArray<BatchRow>) {
        const ids = rows.map(({ id }) => id);

        const counts =
          ids.length === 0
            ? []
            : yield* sql`select batch_id, status, count(*) as count from action_runs where ${sql.in("batch_id", ids)} group by batch_id, status`.pipe(
                Effect.flatMap(decodeCounts),
              );

        const machines =
          ids.length === 0
            ? []
            : yield* sql`select distinct batch_id, machine_name from action_runs where ${sql.in("batch_id", ids)} order by machine_name collate nocase`.pipe(
                Effect.flatMap(decodeMachineNames),
              );

        const byBatch = new Map<BatchId, RunCounts>();
        const machineNames = new Map<BatchId, Array<string>>();

        for (const { batch_id, status, count } of counts) {
          byBatch.set(batch_id, { ...(byBatch.get(batch_id) ?? noRuns), [status]: count });
        }

        for (const { batch_id, machine_name } of machines) {
          machineNames.set(batch_id, [...(machineNames.get(batch_id) ?? []), machine_name]);
        }

        return rows.map((row): ActionBatch => ({
          id: row.id,
          kind: row.kind,
          scope: row.scope_json,
          requestedBy: row.requested_by_json,
          requestedAt: row.requested_at,
          finishedAt: row.finished_at,
          counts: byBatch.get(row.id) ?? noRuns,
          machineNames: machineNames.get(row.id) ?? [],
        }));
      });

      const settleBatch = (runId: RunId, at: DateTime.Utc) =>
        sql`update action_batches set finished_at = ${DateTime.formatIso(at)}
            where id = (select batch_id from action_runs where id = ${runId})
              and finished_at is null
              and not exists (
                select 1 from action_runs
                where batch_id = action_batches.id and ${sql.in("status", activeStatuses)}
              )`;

      const unfinishedRun = ({ runId, machineId }: UnfinishedRun) =>
        sql.and([
          sql`id = ${runId}`,
          sql`machine_id = ${machineId}`,
          sql.in("status", activeStatuses),
        ]);

      return {
        createBatch: Effect.fn("ActivityStore.createBatch")(
          function* (batch) {
            const requestedAt = DateTime.formatIso(batch.requestedAt);
            const settled = batch.runs.every(({ outcome }) => outcome !== null);

            yield* sql`insert into action_batches ${sql.insert({
              id: batch.id,
              kind: batch.kind,
              scope_json: encodeScope(batch.scope),
              requested_at: requestedAt,
              finished_at: settled ? requestedAt : null,
              requested_by_json: batch.requestedBy === null ? null : encodeActor(batch.requestedBy),
            })}`;
            yield* sql`insert into action_runs ${sql.insert(
              batch.runs.map((run) => ({
                id: run.id,
                batch_id: batch.id,
                machine_id: run.machineId,
                machine_name: run.machineName,
                repository_key: run.repositoryKey,
                repository_name: run.repositoryName,
                path: run.path,
                request_json: encodeRequest(run.request),
                status: run.outcome?._tag ?? "Queued",
                outcome_json: run.outcome === null ? null : encodeOutcome(run.outcome),
                finished_at: run.outcome === null ? null : requestedAt,
              })),
            )}`;
          },
          sql.withTransaction,
          Effect.orDie,
        ),
        markStarted: ({ at, ...run }) =>
          sql`update action_runs set status = 'Running', started_at = ${DateTime.formatIso(at)}
              where ${unfinishedRun(run)} returning id`.pipe(
            Effect.map((rows) => rows.length > 0),
            Effect.orDie,
          ),
        markProgress: ({ line, ...run }) =>
          sql`update action_runs set progress = ${line} where ${unfinishedRun(run)} returning id`.pipe(
            Effect.map((rows) => rows.length > 0),
            Effect.orDie,
          ),
        markFinished: Effect.fn("ActivityStore.markFinished")(
          function* ({ outcome, output, at, ...run }) {
            const updated = yield* sql`update action_runs
                  set status = ${outcome._tag}, outcome_json = ${encodeOutcome(outcome)},
                      output_json = ${encodeOutput(output)}, progress = null,
                      finished_at = ${DateTime.formatIso(at)}
                  where ${unfinishedRun(run)} returning id`;

            if (updated.length > 0) {
              yield* settleBatch(run.runId, at);
            }

            return updated.length > 0;
          },
          sql.withTransaction,
          Effect.orDie,
        ),
        unfinished: (within) =>
          sql`select id, machine_id from action_runs where ${sql.and([
            sql.in("status", activeStatuses),
            within._tag === "Batch" ? sql`batch_id = ${within.batchId}` : "1=1",
          ])}`.pipe(
            Effect.flatMap(decodeTargets),
            Effect.map((rows) =>
              rows.map(({ id, machine_id }) => ({ runId: id, machineId: machine_id })),
            ),
            Effect.orDie,
          ),
        activeBatches:
          sql`select * from action_batches where finished_at is null order by requested_at`.pipe(
            Effect.flatMap(decodeBatches),
            Effect.flatMap(summarise),
            Effect.orDie,
          ),
        activeRuns:
          sql`select * from action_runs where ${sql.in("status", activeStatuses)} order by rowid`.pipe(
            Effect.flatMap(decodeRuns),
            Effect.map((rows) => rows.map(toRun)),
            Effect.orDie,
          ),
        latestRuns: sql`select * from action_runs as run
          where run.finished_at is not null and run.status != 'MachineOffline'
            and run.rowid = (
              select latest.rowid from action_runs as latest
              where latest.machine_id = run.machine_id and latest.path = run.path
                and latest.finished_at is not null and latest.status != 'MachineOffline'
              order by latest.finished_at desc, latest.rowid desc
              limit 1
            )`.pipe(
          Effect.flatMap(decodeRuns),
          Effect.map((rows) => rows.map(toRun)),
          Effect.orDie,
        ),
        activity: Effect.fn("ActivityStore.activity")(function* ({ filter, limit }) {
          const runConditions = [
            ["machine_id", filter.machineIds],
            ["repository_key", filter.repositoryKeys],
            ["status", filter.outcomes],
          ] as const;

          const matching = runConditions
            .filter(([, values]) => values.length > 0)
            .map(([column, values]) => sql.in(column, values));

          const batchRows = yield* sql`select * from action_batches as batch where ${
            matching.length === 0
              ? "1=1"
              : sql`exists (select 1 from action_runs where batch_id = batch.id and ${sql.and(matching)})`
          } order by requested_at desc limit ${limit + 1}`.pipe(Effect.flatMap(decodeBatches));

          const eventRows =
            filter.repositoryKeys.length === 0 && filter.outcomes.length === 0
              ? yield* sql`select at, event_json, actor_json from hub_events where ${
                  filter.machineIds.length === 0 ? "1=1" : sql.in("machine_id", filter.machineIds)
                } order by at desc, id desc limit ${limit + 1}`.pipe(Effect.flatMap(decodeEvents))
              : [];

          const batches = yield* summarise(batchRows);

          const entries: Array<ActivityEntry> = [
            ...batches.map((batch) => ({ _tag: "Batch" as const, batch })),
            ...eventRows.map(({ at, event_json, actor_json }) => ({
              _tag: "Event" as const,
              at,
              event: event_json,
              by: actor_json,
            })),
          ];

          const at = (entry: ActivityEntry) =>
            DateTime.toEpochMillis(entry._tag === "Batch" ? entry.batch.requestedAt : entry.at);

          entries.sort((left, right) => at(right) - at(left));

          return { entries: entries.slice(0, limit), hasMore: entries.length > limit };
        }, Effect.orDie),
        batch: Effect.fn("ActivityStore.batch")(
          function* (batchId) {
            const rows = yield* sql`select * from action_batches where id = ${batchId}`.pipe(
              Effect.flatMap(decodeBatches),
            );

            const [batch] = yield* summarise(rows);

            if (batch === undefined) {
              return yield* new BatchNotFound({ batchId });
            }

            const runs = yield* sql`select * from action_runs where batch_id = ${batchId}
              order by repository_name collate nocase, machine_name collate nocase, path`.pipe(
              Effect.flatMap(decodeRuns),
            );

            return {
              batch,
              runs: runs.map((row) => ({ run: toRun(row), output: row.output_json })),
            };
          },
          Effect.catchTag(["SqlError", "SchemaError"], Effect.die),
        ),
        recordEvent: Effect.fn("ActivityStore.recordEvent")(function* (event, by) {
          const machineId = HubEvent.match(event, {
            MachinePaired: ({ machineId: id }) => id,
            MachineRemoved: ({ machineId: id }) => id,
            MachineRenamed: ({ machineId: id }) => id,
            DiscoveryRootsChanged: ({ machineId: id }) => id,
            ProjectFolderCreated: ({ machineId: id }) => id,
            PollingChanged: (): MachineId | null => null,
            IntegrationsChanged: (): MachineId | null => null,
            ArchiveFolderChanged: ({ machineId: id }) => id,
          });

          yield* sql`insert into hub_events ${sql.insert({
            at: DateTime.formatIso(yield* DateTime.now),
            machine_id: machineId,
            event_json: encodeEvent(event),
            actor_json: by === null ? null : encodeActor(by),
          })}`;
        }, Effect.orDie),
        prune: Effect.fn("ActivityStore.prune")(function* (cutoff) {
          const before = DateTime.formatIso(cutoff);

          yield* sql`delete from action_batches where requested_at < ${before}`;
          yield* sql`delete from hub_events where at < ${before}`;
        }, Effect.orDie),
      };
    }),
  );
}
