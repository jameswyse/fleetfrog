import { Link } from "@tanstack/react-router";

import { useRuns } from "@/rpc/hubConnection.ts";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { SidebarPage } from "@/ui/SidebarLayout.tsx";
import { Spinner } from "@/ui/Spinner.tsx";

import { describeActiveRun, describeBatch } from "../actions/actionCopy.ts";
import { CancelButton } from "./CancelButton.tsx";
import { RunCountChips } from "./RunCountChips.tsx";

import type { ActionBatch, ActionRun } from "@fleetfrog/protocol/domain/activity";

/** One batch still going: how far it has got, then each run still waiting or running. */
function RunningBatch({
  batch,
  runs,
}: {
  readonly batch: ActionBatch;
  readonly runs: ReadonlyArray<ActionRun>;
}) {
  const total = Object.values(batch.counts).reduce((sum, count) => sum + count, 0);
  const finished = total - batch.counts.Queued - batch.counts.Running;
  const titleId = `batch-${batch.id}`;
  // Runs under way first, then those waiting their turn, each group in the order it started.
  const ordered = runs.toSorted(
    (left, right) => Number(right.state._tag === "Running") - Number(left.state._tag === "Running"),
  );

  return (
    <section
      aria-labelledby={titleId}
      className="overflow-hidden rounded-xl border border-line bg-surface"
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-sm font-medium">
            <Link
              to="/activity/running"
              search={(previous) => ({ ...previous, batch: batch.id })}
              className="underline-offset-2 hover:underline"
            >
              {describeBatch(batch)}
            </Link>
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-ink-muted">
            <span>
              Started <RelativeTime at={batch.requestedAt} />
            </span>
            <RunCountChips counts={batch.counts} />
          </div>
        </div>
        <CancelButton target={{ _tag: "Batch", batchId: batch.id }} label="Cancel the rest" />
      </div>
      <div
        role="progressbar"
        aria-labelledby={titleId}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={finished}
        aria-valuetext={`${finished} of ${total} finished`}
        className="h-1 bg-line"
      >
        <div
          className="h-full bg-sync motion-safe:transition-[width]"
          style={{ width: `${total === 0 ? 0 : (finished / total) * 100}%` }}
        />
      </div>
      <ul className="divide-y divide-line">
        {ordered.map((run) => (
          <li key={run.id} className="flex min-h-11 items-center gap-3 px-5 py-1.5 text-sm">
            {run.state._tag === "Running" ? (
              <Spinner className="text-sync" />
            ) : (
              <span
                aria-hidden="true"
                className="size-3 shrink-0 rounded-full border-2 border-line"
              />
            )}
            <span className="shrink-0 font-medium">
              {run.repositoryName} <span className="font-normal text-ink-muted">on</span>{" "}
              {run.machineName}
            </span>
            <span className="min-w-0 flex-1 truncate text-ink-muted">{describeActiveRun(run)}</span>
            <CancelButton
              target={{ _tag: "Run", runId: run.id }}
              label="Cancel"
              subject={`${run.repositoryName} on ${run.machineName}`}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Every batch with runs still waiting or running, oldest first. */
export function RunningPage() {
  const { activeBatches, active } = useRuns();

  return (
    <SidebarPage title="Running">
      {activeBatches.length === 0 && (
        <div className="rounded-xl border border-dashed border-line px-5 py-12 text-center text-sm">
          <p className="font-medium">Nothing is running</p>
          <p className="mt-1 text-ink-muted">
            Fetches, pulls and clones appear here until they finish.
          </p>
          <Link
            to="/activity"
            search={({ batch: _batch, ...filters }) => filters}
            className="mt-4 inline-block text-accent-text hover:underline"
          >
            See the history
          </Link>
        </div>
      )}
      {activeBatches.map((batch) => (
        <RunningBatch
          key={batch.id}
          batch={batch}
          runs={active.filter(({ batchId }) => batchId === batch.id)}
        />
      ))}
    </SidebarPage>
  );
}
