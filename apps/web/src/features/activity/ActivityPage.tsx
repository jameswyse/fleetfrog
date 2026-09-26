import { useState } from "react";

import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Option, Schema } from "effect";

import { knownFleet, useHub, useRuns } from "@/rpc/hubConnection.ts";
import { useHubStream } from "@/rpc/useHubStream.ts";
import { Button } from "@/ui/Button.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { Spinner } from "@/ui/Spinner.tsx";
import { activityLimit, activityPageSize } from "@fleetfrog/protocol/dashboard/rpcs";
import { OutcomeKind } from "@fleetfrog/protocol/domain/action";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";
import { MachineId } from "@fleetfrog/protocol/domain/machine";
import { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

import {
  describeActiveRun,
  describeBatch,
  describeCounts,
  describeEvent,
  outcomeKinds,
  outcomeLabels,
} from "../actions/actionCopy.ts";
import { BatchDetailPanel } from "./BatchDetailPanel.tsx";

import type { ReactNode } from "react";

import type {
  ActionBatch,
  ActivityEntry,
  ActivityFilter,
} from "@fleetfrog/protocol/domain/activity";

function BatchLink({
  batch,
  children,
}: {
  readonly batch: ActionBatch;
  readonly children: ReactNode;
}) {
  return (
    <Link
      to="/activity"
      search={(previous) => ({ ...previous, batch: batch.id })}
      className="font-medium underline-offset-2 hover:underline"
    >
      {children}
    </Link>
  );
}

/** Batches still running, each with what its runs are doing now. */
function RunningSection() {
  const { activeBatches, active } = useRuns();

  if (activeBatches.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="running" className="mb-6">
      <h2 id="running" className="mb-2 text-sm font-semibold">
        Running
      </h2>
      <ul className="space-y-3">
        {activeBatches.map((batch) => (
          <li key={batch.id} className="rounded-lg border border-sync/30 bg-surface px-4 py-3">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <BatchLink batch={batch}>{describeBatch(batch)}</BatchLink>
              <span className="text-sm text-ink-muted">
                {describeCounts(batch.counts)} · started <RelativeTime at={batch.requestedAt} />
              </span>
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {active
                .filter(({ batchId }) => batchId === batch.id)
                .map((run) => (
                  <li key={run.id} className="flex min-w-0 items-center gap-2">
                    <Spinner className="text-sync" />
                    <span className="shrink-0 font-medium">
                      {run.repositoryName} on {run.machineName}
                    </span>
                    <span className="truncate text-ink-muted">{describeActiveRun(run)}</span>
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EntryItem({ entry }: { readonly entry: ActivityEntry }) {
  if (entry._tag === "Event") {
    return (
      <li className="flex flex-wrap items-baseline justify-between gap-x-4 px-4 py-3 text-sm">
        <span>{describeEvent(entry.event)}</span>
        <span className="text-ink-muted">
          <RelativeTime at={entry.at} />
        </span>
      </li>
    );
  }

  const { batch } = entry;

  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 px-4 py-3 text-sm">
      <span className="flex flex-wrap items-baseline gap-x-2">
        <BatchLink batch={batch}>{describeBatch(batch)}</BatchLink>
        <span className="text-ink-muted">{describeCounts(batch.counts)}</span>
      </span>
      <span className="text-ink-muted">
        <RelativeTime at={batch.requestedAt} />
      </span>
    </li>
  );
}

const decodeOutcome = Schema.decodeUnknownOption(OutcomeKind);

const selectClass = "mt-1 block min-h-9 w-52 rounded-md border border-line bg-surface px-2";

export function ActivityPage() {
  const hub = useHub();
  const fleet = knownFleet(hub);
  const search = useSearch({ from: "/activity" });
  const navigate = useNavigate({ from: "/activity" });
  const [limit, setLimit] = useState(activityPageSize);
  const filter: ActivityFilter = {
    machineId: search.machine ?? null,
    repositoryKey: search.repository ?? null,
    outcome: search.outcome ?? null,
  };
  const filtered =
    filter.machineId !== null || filter.repositoryKey !== null || filter.outcome !== null;
  const page = useHubStream({
    key: `${filter.machineId}|${filter.repositoryKey}|${filter.outcome}|${limit}`,
    open: (client) => client.WatchActivity({ filter, limit }),
  });

  // Each filter is its own search key, set or removed without touching the others.
  const setMachine = (machine: MachineId | null) =>
    navigate({
      search: ({ machine: _machine, ...rest }) => (machine === null ? rest : { ...rest, machine }),
      replace: true,
    });
  const setRepository = (repository: RepositoryKey | null) =>
    navigate({
      search: ({ repository: _repository, ...rest }) =>
        repository === null ? rest : { ...rest, repository },
      replace: true,
    });
  const setOutcome = (outcome: OutcomeKind | null) =>
    navigate({
      search: ({ outcome: _outcome, ...rest }) => (outcome === null ? rest : { ...rest, outcome }),
      replace: true,
    });

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6">
      <h1 className="text-lg font-semibold">Activity</h1>
      <p className="mb-5 text-sm text-ink-muted">
        Actions and changes from the last 30 days, newest first.
      </p>
      <RunningSection />
      <section aria-labelledby="history">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <h2 id="history" className="me-auto text-sm font-semibold">
            History
          </h2>
          <label className="text-sm">
            <span className="text-ink-muted">Machine</span>
            <select
              value={filter.machineId ?? ""}
              onChange={(event) => {
                const { value } = event.currentTarget;

                void setMachine(value === "" ? null : MachineId.make(value));
              }}
              className={selectClass}
            >
              <option value="">All machines</option>
              {fleet?.machines.map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {machineLabel(machine)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-ink-muted">Repository</span>
            <select
              value={filter.repositoryKey ?? ""}
              onChange={(event) => {
                const { value } = event.currentTarget;

                void setRepository(value === "" ? null : RepositoryKey.make(value));
              }}
              className={selectClass}
            >
              <option value="">All repositories</option>
              {fleet?.repositories.map((repository) => (
                <option key={repository.key} value={repository.key}>
                  {repository.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-ink-muted">Outcome</span>
            <select
              value={filter.outcome ?? ""}
              onChange={(event) =>
                void setOutcome(Option.getOrNull(decodeOutcome(event.currentTarget.value)))
              }
              className={selectClass}
            >
              <option value="">Any outcome</option>
              {outcomeKinds.map((outcome) => (
                <option key={outcome} value={outcome}>
                  {outcomeLabels[outcome]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {page._tag === "Loading" && (
          <p className="py-12 text-center text-sm text-ink-muted">Loading…</p>
        )}
        {page._tag === "Failed" && (
          <p className="py-12 text-center text-sm text-danger">{page.message}</p>
        )}
        {page._tag === "Ready" && page.value.entries.length === 0 && (
          <div className="rounded-lg border border-dashed border-line px-5 py-12 text-center text-sm">
            {filtered ? (
              <>
                <p className="font-medium">Nothing matches these filters</p>
                <Button
                  className="mt-4"
                  onClick={() => {
                    void navigate({
                      search: ({ batch }) => (batch === undefined ? {} : { batch }),
                      replace: true,
                    });
                  }}
                >
                  Clear filters
                </Button>
              </>
            ) : (
              <>
                <p className="font-medium">No activity yet</p>
                <p className="mt-1 text-ink-muted">
                  Fetches, pulls, clones and changes to machines or settings appear here.
                </p>
              </>
            )}
          </div>
        )}
        {page._tag === "Ready" && page.value.entries.length > 0 && (
          <>
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
              {page.value.entries.map((entry) => (
                <EntryItem
                  key={
                    entry._tag === "Batch"
                      ? entry.batch.id
                      : `${entry.event._tag}:${entry.at.epochMilliseconds}`
                  }
                  entry={entry}
                />
              ))}
            </ul>
            {page.value.hasMore && limit < activityLimit && (
              <div className="mt-4 flex justify-center">
                <Button onClick={() => setLimit(Math.min(limit + activityPageSize, activityLimit))}>
                  Show older
                </Button>
              </div>
            )}
          </>
        )}
      </section>
      {search.batch !== undefined && (
        <BatchDetailPanel
          batchId={search.batch}
          onClose={() => {
            void navigate({ search: ({ batch: _batch, ...rest }) => rest });
          }}
        />
      )}
    </div>
  );
}
