import { useHubStream } from "@/rpc/useHubStream.ts";
import { Dialog } from "@/ui/Dialog.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";

import { describeBatch, describeCounts } from "../actions/actionCopy.ts";
import { RunStateText } from "../actions/RunStateText.tsx";
import { PersonalText } from "../preferences/PersonalText.tsx";
import { CancelButton } from "./CancelButton.tsx";

import type { ActionRun, BatchId, RunDetail } from "@fleetfrog/protocol/domain/activity";

/** Problems first, then work in progress, then everything that went to plan. */
const statusOrder = {
  Failed: 0,
  Interrupted: 1,
  Running: 2,
  Queued: 3,
  Skipped: 4,
  Cancelled: 5,
  MachineOffline: 6,
  Succeeded: 7,
} as const;

function rank(run: ActionRun): number {
  return statusOrder[run.state._tag === "Finished" ? run.state.outcome._tag : run.state._tag];
}

function RunItem({ detail }: { readonly detail: RunDetail }) {
  const { run, output } = detail;

  return (
    <li className="border-t border-line py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="font-medium">
            {run.repositoryName} <span className="font-normal text-ink-muted">on</span>{" "}
            {run.machineName}
          </p>
          <p className="font-mono text-[13px] break-all text-ink-muted">
            <PersonalText>{run.path}</PersonalText>
          </p>
        </div>
        {run.state._tag !== "Finished" && (
          <CancelButton
            target={{ _tag: "Run", runId: run.id }}
            label="Cancel"
            subject={`${run.repositoryName} on ${run.machineName}`}
          />
        )}
      </div>
      <p className="mt-1 text-sm">
        <RunStateText run={run} />
      </p>
      {output.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-ink-muted">Git output</summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-canvas px-3 py-2 font-mono text-xs whitespace-pre-wrap">
            <PersonalText>{output.join("\n")}</PersonalText>
          </pre>
        </details>
      )}
    </li>
  );
}

/** Every run in one batch, with the problems first. */
export function BatchDetailPanel({
  batchId,
  onClose,
}: {
  readonly batchId: BatchId;
  readonly onClose: () => void;
}) {
  const detail = useHubStream({
    key: batchId,
    open: (client) => client.WatchBatch({ batchId }),
  });
  const title = detail._tag === "Ready" ? describeBatch(detail.value.batch) : "Action";

  return (
    <Dialog title={title} onClose={onClose} placement="side">
      {detail._tag === "Loading" && <p className="text-sm text-ink-muted">Loading…</p>}
      {detail._tag === "Failed" && <p className="text-sm text-danger">{detail.message}</p>}
      {detail._tag === "Ready" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-ink-muted">
              Started <RelativeTime at={detail.value.batch.requestedAt} />
              {detail.value.batch.requestedBy !== null && (
                <>
                  {" "}
                  by <span data-personal>{detail.value.batch.requestedBy.name}</span>
                </>
              )}
              {" · "}
              {describeCounts(detail.value.batch.counts)}
            </p>
            {detail.value.batch.finishedAt === null && (
              <CancelButton target={{ _tag: "Batch", batchId }} label="Cancel the rest" />
            )}
          </div>
          <ul>
            {detail.value.runs
              .toSorted((left, right) => rank(left.run) - rank(right.run))
              .map((run) => (
                <RunItem key={run.run.id} detail={run} />
              ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}
