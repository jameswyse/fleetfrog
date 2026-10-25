import { useEffect, useEffectEvent, useState } from "react";

import { Link } from "@tanstack/react-router";

import { requestHub } from "@/rpc/hubConnection.ts";
import { useHubStream } from "@/rpc/useHubStream.ts";
import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { folderName } from "@/ui/folderName.ts";
import { plural } from "@/ui/plural.ts";
import { Spinner } from "@/ui/Spinner.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { useStartBatch } from "../actions/useStartBatch.ts";
import { worktreeThread } from "../t3Code/t3CodeLookup.ts";

import type { BatchDetail, BatchId, TargetedRun } from "@fleetfrog/protocol/domain/activity";
import type { Machine } from "@fleetfrog/protocol/domain/fleet";
import type { WorktreeInspection } from "@fleetfrog/protocol/domain/trash";

export interface FinishedWorktree {
  readonly mainPath: string;
  readonly path: string;
  readonly branch: string;
  readonly sha: string;
}

type Check =
  | { readonly _tag: "Checking" }
  | { readonly _tag: "Removable"; readonly inspection: WorktreeInspection }
  | { readonly _tag: "Kept"; readonly reason: string };

type Stage =
  | { readonly _tag: "Reviewing" }
  | { readonly _tag: "Removing"; readonly batchId: BatchId }
  | { readonly _tag: "Deleting"; readonly batchId: BatchId; readonly removed: number }
  | {
      readonly _tag: "Done";
      readonly batchId: BatchId;
      readonly removed: number;
      readonly deleted: number;
    };

async function inspect(machineId: Machine["id"], worktree: FinishedWorktree): Promise<Check> {
  const result = await requestHub((client) =>
    client.InspectCheckout({ machineId, path: worktree.mainPath, worktree: worktree.path }),
  );

  if (result._tag === "Failure") {
    return { _tag: "Kept", reason: `Couldn't check it: ${result.message}` };
  }

  if (result.value._tag !== "WorktreeInspected") {
    return {
      _tag: "Kept",
      reason:
        result.value._tag === "Failed"
          ? `Couldn't check it: ${result.value.message}`
          : "The machine inspected the wrong thing.",
    };
  }

  const { inspection } = result.value;

  if (inspection.changedFiles + inspection.untrackedFiles > 0) {
    return {
      _tag: "Kept",
      reason: "It has changes now. Remove it on its own to choose what happens to them.",
    };
  }

  return { _tag: "Removable", inspection };
}

function losses(inspection: WorktreeInspection): string {
  const { ignored } = inspection;

  if (inspection.missing !== null) {
    return "Its folder is already gone, so this only removes Git's record of it.";
  }

  if (ignored.total === 0) {
    return "Nothing else is deleted.";
  }

  const examples = ignored.items.slice(0, 3).map(({ path }) => folderName(path));

  return `Also deletes ${plural(ignored.total, "ignored file or folder", "ignored files or folders")} for good, such as ${examples.join(", ")}.`;
}

function succeeded(detail: BatchDetail) {
  return detail.runs.flatMap(({ run }) =>
    run.state._tag === "Finished" && run.state.outcome._tag === "Succeeded" ? [run] : [],
  );
}

function BatchWatcher({
  batchId,
  onFinished,
}: {
  readonly batchId: BatchId;
  readonly onFinished: (detail: BatchDetail) => void;
}) {
  const detail = useHubStream({ key: batchId, open: (client) => client.WatchBatch({ batchId }) });

  const finishedAt =
    detail._tag === "Ready" ? (detail.value.batch.finishedAt?.epochMilliseconds ?? null) : null;

  const report = useEffectEvent(() => {
    if (detail._tag === "Ready") {
      onFinished(detail.value);
    }
  });

  useEffect(() => {
    if (finishedAt !== null) {
      report();
    }
  }, [finishedAt]);

  return detail._tag === "Failed" ? <p className="text-danger">{detail.message}</p> : null;
}

export function CleanUpWorktreesDialog({
  machine,
  worktrees,
  onClose,
}: {
  readonly machine: Machine;
  readonly worktrees: ReadonlyArray<FinishedWorktree>;
  readonly onClose: () => void;
}) {
  const { start, pending, failure } = useStartBatch();
  const [checks, setChecks] = useState<ReadonlyMap<string, Check>>(new Map());
  const [stage, setStage] = useState<Stage>({ _tag: "Reviewing" });
  const machineId = machine.id;

  useEffect(() => {
    let current = true;

    const load = async () => {
      const results = await Promise.all(
        worktrees.map(
          async (worktree) => [worktree.path, await inspect(machineId, worktree)] as const,
        ),
      );

      if (current) {
        setChecks(new Map(results));
      }
    };

    void load();

    return () => {
      current = false;
    };
  }, [machineId, worktrees]);

  const checkOf = (worktree: FinishedWorktree): Check =>
    checks.get(worktree.path) ?? { _tag: "Checking" };

  const removable = worktrees.flatMap((worktree) => {
    const check = checkOf(worktree);

    return check._tag === "Removable" ? [{ worktree, inspection: check.inspection }] : [];
  });

  const checking = worktrees.some((worktree) => checkOf(worktree)._tag === "Checking");

  const remove = () => {
    const [first, ...rest] = removable.map(({ worktree, inspection }): TargetedRun => ({
      machineId: machine.id,
      request: {
        _tag: "RemoveWorktree",
        path: worktree.mainPath,
        worktree: worktree.path,
        fingerprint: inspection.fingerprint,
        discardChanges: false,
      },
    }));

    if (first !== undefined) {
      start({ _tag: "Targeted", runs: [first, ...rest] }, (batchId) =>
        setStage({ _tag: "Removing", batchId }),
      );
    }
  };

  const deleteBranches = (removal: BatchDetail) => {
    const removedPaths = new Set(
      succeeded(removal).flatMap(({ request }) =>
        request._tag === "RemoveWorktree" ? [request.worktree] : [],
      ),
    );

    const removed = worktrees.filter(({ path }) => removedPaths.has(path));

    const [first, ...rest] = [...Map.groupBy(removed, ({ mainPath }) => mainPath)].flatMap(
      ([mainPath, clone]): ReadonlyArray<TargetedRun> => {
        const [branch, ...others] = clone.map(({ branch: name, sha }) => ({ name, sha }));

        return branch === undefined
          ? []
          : [
              {
                machineId: machine.id,
                request: { _tag: "DeleteBranches", path: mainPath, branches: [branch, ...others] },
              },
            ];
      },
    );

    if (first === undefined) {
      setStage({ _tag: "Done", batchId: removal.batch.id, removed: 0, deleted: 0 });

      return;
    }

    start({ _tag: "Targeted", runs: [first, ...rest] }, (batchId) =>
      setStage({ _tag: "Deleting", batchId, removed: removed.length }),
    );
  };

  const finish = (deletion: BatchDetail, removed: number) => {
    const deleted = succeeded(deletion).reduce(
      (sum, { state }) =>
        state._tag === "Finished" &&
        state.outcome._tag === "Succeeded" &&
        state.outcome.result._tag === "BranchesDeleted"
          ? sum + state.outcome.result.branches
          : sum,
      0,
    );

    setStage({ _tag: "Done", batchId: deletion.batch.id, removed, deleted });
  };

  const title = {
    Reviewing: `Clean up ${plural(worktrees.length, "finished worktree")}?`,
    Removing: "Cleaning up",
    Deleting: "Cleaning up",
    Done: "Cleaned up",
  }[stage._tag];

  return (
    <Dialog title={title} onClose={onClose}>
      <div className="space-y-4 text-sm">
        {stage._tag === "Reviewing" && (
          <>
            <p>
              Each worktree's folder is removed from {machineLabel(machine)}, and its branch moves
              to the Trash, where you can restore it until you empty it.
            </p>
            <ul className="max-h-[50vh] space-y-3 overflow-y-auto">
              {worktrees.map((worktree) => {
                const check = checkOf(worktree);
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
                      <p className="text-xs text-ink-muted">T3 Code thread: “{thread.title}”</p>
                    )}
                    <p className="text-xs text-ink-muted">
                      {check._tag === "Checking" && (
                        <span className="inline-flex items-center gap-1.5">
                          <Spinner />
                          Checking…
                        </span>
                      )}
                      {check._tag === "Removable" && losses(check.inspection)}
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
        {(stage._tag === "Removing" || stage._tag === "Deleting") && (
          <p className="flex items-center gap-2">
            <Spinner />
            {stage._tag === "Removing"
              ? `Removing ${plural(removable.length, "worktree")}…`
              : `Moving ${plural(stage.removed, "branch", "branches")} to the Trash…`}
          </p>
        )}
        {stage._tag === "Removing" && (
          <BatchWatcher batchId={stage.batchId} onFinished={deleteBranches} />
        )}
        {stage._tag === "Deleting" && (
          <BatchWatcher
            batchId={stage.batchId}
            onFinished={(detail) => finish(detail, stage.removed)}
          />
        )}
        {stage._tag === "Done" && (
          <p>
            Removed {plural(stage.removed, "worktree")} and moved{" "}
            {plural(stage.deleted, "branch", "branches")} to the Trash.{" "}
            {(stage.removed < removable.length || stage.deleted < stage.removed) && (
              <span className="text-changes">Some were skipped. </span>
            )}
            <Link
              to="/activity"
              search={{ batch: stage.batchId }}
              className="text-accent-text underline-offset-2 hover:underline"
            >
              View in Activity
            </Link>
          </p>
        )}
        <p role="status" className="text-danger">
          {failure}
        </p>
        <div className="flex justify-end gap-3">
          {stage._tag === "Reviewing" ? (
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button
                tone="danger"
                disabled={checking || pending || removable.length === 0}
                onClick={remove}
              >
                {pending
                  ? "Starting…"
                  : `Remove ${plural(removable.length, "worktree")} and branches`}
              </Button>
            </>
          ) : (
            <Button onClick={onClose}>{stage._tag === "Done" ? "Done" : "Close"}</Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
