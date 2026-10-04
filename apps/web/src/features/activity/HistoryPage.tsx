import { useState } from "react";

import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { DateTime } from "effect";

import { useHubStream } from "@/rpc/useHubStream.ts";
import { Button } from "@/ui/Button.tsx";
import { formatDuration } from "@/ui/formatDuration.ts";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { SidebarPage } from "@/ui/SidebarLayout.tsx";
import { Spinner } from "@/ui/Spinner.tsx";
import { activityLimit, activityPageSize } from "@fleetfrog/protocol/dashboard/rpcs";
import { activityRetentionDays, HubEvent } from "@fleetfrog/protocol/domain/activity";

import { describeBatch, describeEvent } from "../actions/actionCopy.ts";
import { RunCountChips } from "./RunCountChips.tsx";

import type {
  ActionBatch,
  ActivityEntry,
  ActivityFilter,
} from "@fleetfrog/protocol/domain/activity";

function eventMachine(event: HubEvent): string {
  return HubEvent.match(event, {
    MachinePaired: ({ machineName }) => machineName,
    MachineRemoved: ({ machineName }) => machineName,
    MachineRenamed: ({ to }) => to,
    DiscoveryRootsChanged: ({ machineName }) => machineName,
    ProjectFolderCreated: ({ machineName }) => machineName,
    PollingChanged: () => "",
    IntegrationsChanged: () => "",
    ArchiveFolderChanged: ({ machineName }) => machineName,
  });
}

const cellClass = "px-4 py-3 align-top";

function BatchRow({ batch, open }: { readonly batch: ActionBatch; readonly open: boolean }) {
  const navigate = useNavigate({ from: "/activity" });

  return (
    <tr
      onClick={(event) => {
        if (!(event.target instanceof Element && event.target.closest("a") !== null)) {
          void navigate({ search: (previous) => ({ ...previous, batch: batch.id }) });
        }
      }}
      className={`cursor-pointer hover:bg-surface-raised ${open ? "bg-surface-raised" : ""}`}
    >
      <td className={`${cellClass} whitespace-nowrap text-ink-muted`}>
        <RelativeTime at={batch.requestedAt} />
      </td>
      <th scope="row" className={`${cellClass} text-start font-medium`}>
        <Link
          to="/activity"
          search={(previous) => ({ ...previous, batch: batch.id })}
          className="underline-offset-2 hover:underline"
        >
          {describeBatch(batch)}
        </Link>
        {batch.requestedBy !== null && (
          <span className="block text-sm font-normal text-ink-muted">
            by {batch.requestedBy.name}
          </span>
        )}
      </th>
      <td className={`${cellClass} text-ink-muted`}>{batch.machineNames.join(", ")}</td>
      <td className={cellClass}>
        <RunCountChips counts={batch.counts} />
      </td>
      <td className={`${cellClass} text-end whitespace-nowrap text-ink-muted tabular-nums`}>
        {batch.finishedAt === null ? (
          <span className="inline-flex items-center gap-1.5 text-sync">
            <Spinner />
            Running
          </span>
        ) : (
          formatDuration(
            DateTime.toEpochMillis(batch.finishedAt) - DateTime.toEpochMillis(batch.requestedAt),
          )
        )}
      </td>
    </tr>
  );
}

function EventRow({ entry }: { readonly entry: Extract<ActivityEntry, { _tag: "Event" }> }) {
  return (
    <tr>
      <td className={`${cellClass} whitespace-nowrap text-ink-muted`}>
        <RelativeTime at={entry.at} />
      </td>
      <th scope="row" className={`${cellClass} text-start font-normal`}>
        {describeEvent(entry.event)}
        {entry.by !== null && (
          <span className="block text-sm text-ink-muted">by {entry.by.name}</span>
        )}
      </th>
      <td className={`${cellClass} text-ink-muted`}>{eventMachine(entry.event)}</td>
      <td className={cellClass} />
      <td className={cellClass} />
    </tr>
  );
}

export function HistoryPage() {
  const search = useSearch({ from: "/_app/activity/" });
  const navigate = useNavigate({ from: "/activity" });
  const [limit, setLimit] = useState(activityPageSize);

  const filter: ActivityFilter = {
    machineIds: search.machines ?? [],
    repositoryKeys: search.repositories ?? [],
    outcomes: search.outcomes ?? [],
  };

  const filtered =
    filter.machineIds.length + filter.repositoryKeys.length + filter.outcomes.length > 0;

  const page = useHubStream({
    key: `${JSON.stringify(filter)}|${limit}`,
    open: (client) => client.WatchActivity({ filter, limit }),
  });

  return (
    <SidebarPage
      title="History"
      action={
        <p className="text-sm text-ink-muted">
          The last {activityRetentionDays} days, newest first
        </p>
      }
    >
      {page._tag === "Loading" && (
        <p className="py-12 text-center text-sm text-ink-muted">Loading…</p>
      )}
      {page._tag === "Failed" && (
        <p className="py-12 text-center text-sm text-danger">{page.message}</p>
      )}
      {page._tag === "Ready" && page.value.entries.length === 0 && (
        <div className="rounded-xl border border-dashed border-line px-5 py-12 text-center text-sm">
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
        <div>
          <div className="relative overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-2xl text-sm">
              <caption className="sr-only">
                Activity, newest first. Open an action to see each of its runs.
              </caption>
              <thead className="border-b border-line text-xs text-ink-muted">
                <tr>
                  <th scope="col" className="px-4 py-2.5 text-start font-medium">
                    When
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-start font-medium">
                    Action
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-start font-medium">
                    Machines
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-start font-medium">
                    Result
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-end font-medium">
                    Duration
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {page.value.entries.map((entry) =>
                  entry._tag === "Batch" ? (
                    <BatchRow
                      key={entry.batch.id}
                      batch={entry.batch}
                      open={search.batch === entry.batch.id}
                    />
                  ) : (
                    <EventRow
                      key={`${entry.event._tag}:${entry.at.epochMilliseconds}`}
                      entry={entry}
                    />
                  ),
                )}
              </tbody>
            </table>
          </div>
          {page.value.hasMore && limit < activityLimit && (
            <div className="mt-4 flex justify-center">
              <Button onClick={() => setLimit(Math.min(limit + activityPageSize, activityLimit))}>
                Show older
              </Button>
            </div>
          )}
        </div>
      )}
    </SidebarPage>
  );
}
