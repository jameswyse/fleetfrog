import { useEffect, useEffectEvent, useState } from "react";

import { Link } from "@tanstack/react-router";
import { BotIcon } from "lucide-react";

import { requestHub } from "@/rpc/hubConnection.ts";
import { useHubStream } from "@/rpc/useHubStream.ts";
import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { folderName } from "@/ui/folderName.ts";
import { plural } from "@/ui/plural.ts";
import { Spinner } from "@/ui/Spinner.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { useStartBatch } from "../actions/useStartBatch.ts";
import { busyThreads, worktreeThread } from "../t3Code/t3CodeLookup.ts";
import {
  branchDeletionRuns,
  cleanUpCheck,
  cleanUpLosses,
  deletedBranchCount,
  removalRuns,
  removedWorktrees,
} from "./worktreeCleanUp.ts";
import { worktreeInspectionFrom } from "./worktreeInspection.ts";

import type { BatchDetail, BatchId, TargetedRun } from "@fleetfrog/protocol/domain/activity";
import type { Machine } from "@fleetfrog/protocol/domain/fleet";

import type { FinishedWorktree } from "./worktreeCleanUp.ts";
import type { WorktreeInspectionState } from "./worktreeInspection.ts";

interface Progress {
  readonly attempted: number;
  readonly removed: number;
  readonly branches: number;
}

type Stage =
  | { readonly _tag: "Reviewing" }
  | { readonly _tag: "Removing"; readonly batchId: BatchId; readonly attempted: number }
  | {
      readonly _tag: "Removed";
      readonly batchId: BatchId;
      readonly progress: Progress;
      readonly runs: readonly [TargetedRun, ...Array<TargetedRun>];
    }
  | { readonly _tag: "Deleting"; readonly batchId: BatchId; readonly progress: Progress }
  | {
      readonly _tag: "Done";
      readonly batchId: BatchId;
      readonly progress: Progress;
      readonly deleted: number;
    }
  | { readonly _tag: "Lost"; readonly batchId: BatchId; readonly message: string };

function BatchWatcher({
  batchId,
  onFinished,
  onLost,
}: {
  readonly batchId: BatchId;
  readonly onFinished: (detail: BatchDetail) => void;
  readonly onLost: (message: string) => void;
}) {
  const detail = useHubStream({ key: batchId, open: (client) => client.WatchBatch({ batchId }) });

  const finishedAt =
    detail._tag === "Ready" ? (detail.value.batch.finishedAt?.epochMilliseconds ?? null) : null;

  const lost = detail._tag === "Failed" ? detail.message : null;

  const report = useEffectEvent(() => {
    if (detail._tag === "Ready") {
      onFinished(detail.value);
    }
  });

  const reportLost = useEffectEvent((message: string) => onLost(message));

  useEffect(() => {
    if (finishedAt !== null) {
      report();
    }
  }, [finishedAt]);

  useEffect(() => {
    if (lost !== null) {
      reportLost(lost);
    }
  }, [lost]);

  return null;
}

export function CleanUpWorktreesDialog({
  machine,
  worktrees,
  finished,
  onClose,
}: {
  readonly machine: Machine;
  readonly worktrees: ReadonlyArray<FinishedWorktree>;
  readonly finished: ReadonlyArray<FinishedWorktree>;
  readonly onClose: () => void;
}) {
  const { start, pending, failure } = useStartBatch();

  const [inspections, setInspections] = useState<ReadonlyMap<string, WorktreeInspectionState>>(
    new Map(),
  );

  const [stage, setStage] = useState<Stage>({ _tag: "Reviewing" });
  const machineId = machine.id;

  useEffect(() => {
    let current = true;

    const load = async () => {
      const results = await Promise.all(
        worktrees.map(async ({ mainPath, path }) => {
          const result = await requestHub((client) =>
            client.InspectCheckout({ machineId, path: mainPath, worktree: path }),
          );

          return [path, worktreeInspectionFrom(result)] as const;
        }),
      );

      if (current) {
        setInspections(new Map(results));
      }
    };

    void load();

    return () => {
      current = false;
    };
  }, [machineId, worktrees]);

  const checks = worktrees.map((worktree) => ({
    worktree,
    check: cleanUpCheck({
      worktree,
      inspection: inspections.get(worktree.path) ?? { _tag: "Checking" },
      busy: busyThreads(machine, [worktree.path]).length > 0,
      finished: finished.some(
        ({ path, branch, sha }) =>
          path === worktree.path && branch === worktree.branch && sha === worktree.sha,
      ),
    }),
  }));

  const removable = checks.flatMap(({ worktree, check }) =>
    check._tag === "Removable" ? [{ worktree, inspection: check.inspection }] : [],
  );

  const checking = checks.some(({ check }) => check._tag === "Checking");
  const removal = removalRuns({ machineId, removable });

  const deleteBranches = (
    runs: readonly [TargetedRun, ...Array<TargetedRun>],
    progress: Progress,
  ) =>
    start({ _tag: "Targeted", runs }, (batchId) =>
      setStage({ _tag: "Deleting", batchId, progress }),
    );

  const onRemoved = (detail: BatchDetail) => {
    const removed = removedWorktrees({ worktrees, runs: detail.runs.map(({ run }) => run) });
    const runs = branchDeletionRuns({ machineId, removed });

    const progress = {
      attempted: detail.runs.length,
      removed: removed.length,
      branches: (runs ?? []).reduce(
        (sum, { request }) =>
          request._tag === "DeleteBranches" ? sum + request.branches.length : sum,
        0,
      ),
    };

    if (runs === null) {
      setStage({ _tag: "Done", batchId: detail.batch.id, progress, deleted: 0 });

      return;
    }

    setStage({ _tag: "Removed", batchId: detail.batch.id, progress, runs });
    deleteBranches(runs, progress);
  };

  const onDeleted = (detail: BatchDetail, progress: Progress) =>
    setStage({
      _tag: "Done",
      batchId: detail.batch.id,
      progress,
      deleted: deletedBranchCount(detail.runs.map(({ run }) => run)),
    });

  const onLost = (batchId: BatchId) => (message: string) =>
    setStage({ _tag: "Lost", batchId, message });

  const working =
    stage._tag === "Removing" ||
    stage._tag === "Deleting" ||
    (stage._tag === "Removed" && (pending || failure === null));

  const title = {
    Reviewing: `Clean up ${plural(worktrees.length, "finished worktree")}?`,
    Removing: "Cleaning up",
    Removed: "Cleaning up",
    Deleting: "Cleaning up",
    Done: "Cleaned up",
    Lost: "Lost track of the clean-up",
  }[stage._tag];

  return (
    <Dialog title={title} onClose={onClose} dismissible={!working && !pending}>
      <div className="space-y-4 text-sm">
        {stage._tag === "Reviewing" && (
          <>
            <p>
              Each worktree's folder is removed from {machineLabel(machine)}, and its branch moves
              to the Trash, where you can restore it until you empty it.
            </p>
            <ul className="max-h-[50vh] space-y-3 overflow-y-auto">
              {checks.map(({ worktree, check }) => {
                const thread = worktreeThread(machine, worktree.path);

                return (
                  <li key={worktree.path} className="space-y-0.5">
                    <p className="flex items-baseline gap-2">
                      <span className="min-w-0 truncate font-mono text-[13px] font-medium">
                        {worktree.branch}
                      </span>
                      <span className="shrink-0 text-xs text-ink-muted">
                        {folderName(worktree.path)}
                      </span>
                    </p>
                    {thread !== undefined && (
                      <p className="flex items-center gap-1.5 text-xs text-ink-muted">
                        <BotIcon aria-hidden="true" className="size-3.5 shrink-0" />
                        <span className="sr-only">T3 Code thread: </span>
                        <span className="min-w-0 truncate">{thread.title}</span>
                      </p>
                    )}
                    <p className="text-xs text-ink-muted">
                      {check._tag === "Checking" && (
                        <span className="inline-flex items-center gap-1.5">
                          <Spinner />
                          Checking…
                        </span>
                      )}
                      {check._tag === "Removable" && cleanUpLosses(check.inspection)}
                      {check._tag === "Kept" && (
                        <span className="text-changes">Kept. {check.reason}</span>
                      )}
                    </p>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {working && (
          <p role="status" className="flex items-center gap-2">
            <Spinner />
            {stage._tag === "Removing"
              ? `Removing ${plural(stage.attempted, "worktree")}…`
              : "Moving their branches to the Trash…"}
          </p>
        )}
        {stage._tag === "Removing" && (
          <BatchWatcher
            batchId={stage.batchId}
            onFinished={onRemoved}
            onLost={onLost(stage.batchId)}
          />
        )}
        {stage._tag === "Deleting" && (
          <BatchWatcher
            batchId={stage.batchId}
            onFinished={(detail) => onDeleted(detail, stage.progress)}
            onLost={onLost(stage.batchId)}
          />
        )}
        {stage._tag === "Removed" && !working && (
          <p>
            Removed {plural(stage.progress.removed, "worktree")}, but their branches weren't moved
            to the Trash. Try again, or delete them later from Other branches.
          </p>
        )}
        {stage._tag === "Lost" && (
          <p>
            FleetFrog stopped hearing about this clean-up: {stage.message} Check Activity for what
            happened. Any branches left behind show under Other branches.
          </p>
        )}
        {stage._tag === "Done" && (
          <p>
            Removed {plural(stage.progress.removed, "worktree")} and moved{" "}
            {plural(stage.deleted, "branch", "branches")} to the Trash.
            {(stage.progress.removed < stage.progress.attempted ||
              stage.deleted < stage.progress.branches) && (
              <span className="text-changes"> Some were skipped.</span>
            )}
          </p>
        )}
        {(stage._tag === "Done" || stage._tag === "Lost") && (
          <Link
            to="/activity"
            search={{ batch: stage.batchId }}
            className="inline-block text-accent-text underline-offset-2 hover:underline"
          >
            View in Activity
          </Link>
        )}
        <p role="status" className="text-danger">
          {failure}
        </p>
        <div className="flex justify-end gap-3">
          {stage._tag === "Reviewing" && (
            <>
              <Button disabled={pending} onClick={onClose}>
                Cancel
              </Button>
              <Button
                tone="danger"
                disabled={checking || pending || removal === null}
                onClick={() => {
                  if (removal !== null) {
                    start({ _tag: "Targeted", runs: removal }, (batchId) =>
                      setStage({ _tag: "Removing", batchId, attempted: removal.length }),
                    );
                  }
                }}
              >
                {pending
                  ? "Starting…"
                  : `Remove ${plural(removable.length, "worktree")} and branches`}
              </Button>
            </>
          )}
          {stage._tag === "Removed" && !working && (
            <>
              <Button onClick={onClose}>Close</Button>
              <Button onClick={() => deleteBranches(stage.runs, stage.progress)}>Try again</Button>
            </>
          )}
          {(stage._tag === "Done" || stage._tag === "Lost") && (
            <Button onClick={onClose}>Done</Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
