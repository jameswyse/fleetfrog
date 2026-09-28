import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`alter table machines add column root_statuses_json text not null default '[]'`;
  yield* sql`
    create table action_batches (
      id text primary key,
      kind text not null,
      scope_json text not null,
      requested_at text not null,
      finished_at text
    )
  `;
  yield* sql`create index action_batches_requested_at on action_batches (requested_at)`;
  // Runs keep the machine's name and outlive it, so history survives removing a machine.
  yield* sql`
    create table action_runs (
      id text primary key,
      batch_id text not null references action_batches (id) on delete cascade,
      machine_id text not null,
      machine_name text not null,
      repository_key text not null,
      repository_name text not null,
      path text not null,
      request_json text not null,
      status text not null,
      progress text,
      outcome_json text,
      output_json text not null default '[]',
      started_at text,
      finished_at text
    )
  `;
  yield* sql`create index action_runs_batch on action_runs (batch_id)`;
  yield* sql`create index action_runs_target on action_runs (machine_id, path, finished_at)`;
  yield* sql`
    create table hub_events (
      id integer primary key,
      at text not null,
      machine_id text,
      event_json text not null
    )
  `;
  yield* sql`create index hub_events_at on hub_events (at)`;
});
