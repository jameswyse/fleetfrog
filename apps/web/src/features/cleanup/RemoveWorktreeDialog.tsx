import { useEffect, useState } from "react";

import { TriangleAlertIcon } from "lucide-react";

import { requestHub } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { formatBytes } from "@/ui/formatBytes.ts";
import { plural } from "@/ui/plural.ts";
import { Spinner } from "@/ui/Spinner.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { useStartBatch } from "../actions/useStartBatch.ts";
import { busyThreads, worktreeThread } from "../t3Code/t3CodeLookup.ts";
import { BusyThreadsNotice, WorktreeThreadNote } from "../t3Code/T3CodeNotices.tsx";

import type { HubResult } from "@/rpc/hubConnection.ts";
import type { Machine } from "@fleetfrog/protocol/domain/fleet";
import type { InspectionResult, WorktreeInspection } from "@fleetfrog/protocol/domain/trash";

type InspectionState =
  | { readonly _tag: "Checking" }
  | { readonly _tag: "Failed"; readonly message: string }
  | { readonly _tag: "Ready"; readonly inspection: WorktreeInspection };

function stateFrom(result: HubResult<InspectionResult>): InspectionState {
  if (result._tag === "Failure") {
    return { _tag: "Failed", message: result.message };
  }

  const { value } = result;

  if (value._tag === "WorktreeInspected") {
    return { _tag: "Ready", inspection: value.inspection };
  }

  return {
    _tag: "Failed",
    message: value._tag === "Failed" ? value.message : "The machine inspected the wrong thing.",
  };
}

function keptWork(inspection: WorktreeInspection): ReadonlyArray<string> {
  const lines: Array<string> = [];
  const { changedFiles, untrackedFiles, unreachableCommits, locked } = inspection;

  if (changedFiles + untrackedFiles > 0) {
    const parts = [
      changedFiles > 0 && plural(changedFiles, "changed file"),
      untrackedFiles > 0 && plural(untrackedFiles, "untracked file"),
    ].filter((part) => part !== false);

    const one = changedFiles + untrackedFiles === 1;

    lines.push(
      `Its ${parts.join(" and ")} ${one ? "is" : "are"} stashed first, so you can bring ${one ? "it" : "them"} back from the Stashes list.`,
    );
  }

  if (unreachableCommits > 0) {
    lines.push(
      `The ${plural(unreachableCommits, "commit")} only its detached HEAD holds ${unreachableCommits === 1 ? "goes" : "go"} to the Trash, as a branch you can restore.`,
    );
  }

  if (locked !== null) {
    lines.push(
      locked === ""
        ? "It's locked against removal, and removing it unlocks it."
        : `It's locked against removal (“${locked}”), and removing it unlocks it.`,
    );
  }

  return lines;
}

function MissingNote({ parentMissing }: { readonly parentMissing: boolean }) {
  return parentMissing ? (
    <p className="flex items-start gap-2 rounded-md border border-changes/40 bg-changes-soft px-3 py-2">
      <TriangleAlertIcon className="mt-0.5 shrink-0 text-changes" />
      <span>
        Its folder and the folder above it are gone, perhaps on a disk that isn't connected.
        Removing it only forgets it. If the disk comes back, the folder is still there, but Git no
        longer treats it as a worktree.
      </span>
    </p>
  ) : (
    <p>Its folder is already gone, so this only removes Git's record of it.</p>
  );
}

function InspectionDetails({
  inspection,
  machine,
}: {
  readonly inspection: WorktreeInspection;
  readonly machine: Machine;
}) {
  const kept = keptWork(inspection);
  const { ignored, caches } = inspection;

  return (
    <>
      <p>
        The folder is deleted from {machineLabel(machine)}.{" "}
        {inspection.branch === null
          ? "Its HEAD is detached."
          : `Its branch, ${inspection.branch}, stays in the repository.`}
        {caches.length > 0 &&
          ` Caches such as ${caches
            .slice(0, 2)
            .map(({ path }) => path)
            .join(" and ")} go too, and tools rebuild them.`}
      </p>
      {kept.length > 0 && (
        <ul className="ms-5 list-disc space-y-1">
          {kept.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {ignored.total > 0 && (
        <div className="rounded-md border border-changes/40 bg-changes-soft px-3 py-2">
          <p className="flex items-center gap-2 font-medium text-changes">
            <TriangleAlertIcon className="shrink-0" />
            {plural(ignored.total, "ignored file or folder", "ignored files or folders")} can't be
            kept and {ignored.total === 1 ? "is" : "are"} deleted for good:
          </p>
          <ul className="mt-1 ms-6 list-disc space-y-0.5 break-words">
            {ignored.items.slice(0, 5).map(({ path, sizeBytes }) => (
              <li key={path}>
                <span className="font-mono text-[13px]">{path}</span> ({formatBytes(sizeBytes)})
              </li>
            ))}
            {ignored.total > 5 && <li>and {ignored.total - 5} more</li>}
          </ul>
        </div>
      )}
    </>
  );
}

export function RemoveWorktreeDialog({
  machine,
  mainPath,
  worktree,
  onClose,
}: {
  readonly machine: Machine;
  readonly mainPath: string;
  readonly worktree: string;
  readonly onClose: () => void;
}) {
  const { start, pending, failure } = useStartBatch();
  const [state, setState] = useState<InspectionState>({ _tag: "Checking" });

  useEffect(() => {
    let current = true;

    const load = async () => {
      const result = await requestHub((client) =>
        client.InspectCheckout({ machineId: machine.id, path: mainPath, worktree }),
      );

      if (current) {
        setState(stateFrom(result));
      }
    };

    void load();

    return () => {
      current = false;
    };
  }, [machine.id, mainPath, worktree]);

  const inspection = state._tag === "Ready" ? state.inspection : null;

  const agents = busyThreads(machine, [worktree]);

  return (
    <Dialog title="Remove this worktree?" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="font-mono text-[13px] break-all text-ink-muted">{worktree}</p>
        {agents.length > 0 ? (
          <BusyThreadsNotice
            threads={agents}
            where="in this worktree"
            consequence="Removing it stashes the changes it's making and deletes the folder it works in."
          />
        ) : (
          <WorktreeThreadNote thread={worktreeThread(machine, worktree)} />
        )}
        {state._tag === "Checking" && (
          <p role="status" className="flex items-center gap-2 text-ink-muted">
            <Spinner />
            Checking the worktree on {machineLabel(machine)}…
          </p>
        )}
        {state._tag === "Failed" && (
          <p role="status" className="text-danger">
            Couldn't check the worktree: {state.message}
          </p>
        )}
        {inspection !== null &&
          (inspection.missing === null ? (
            <InspectionDetails inspection={inspection} machine={machine} />
          ) : (
            <MissingNote parentMissing={inspection.missing.parentMissing} />
          ))}
        <p role="status" className="text-danger">
          {failure}
        </p>
        <div className="flex justify-end gap-3">
          <Button onClick={onClose}>Cancel</Button>
          {inspection !== null && (
            <Button
              tone="danger"
              disabled={pending}
              onClick={() =>
                start(
                  {
                    _tag: "Targeted",
                    runs: [
                      {
                        machineId: machine.id,
                        request: {
                          _tag: "RemoveWorktree",
                          path: mainPath,
                          worktree,
                          fingerprint: inspection.fingerprint,
                        },
                      },
                    ],
                  },
                  onClose,
                )
              }
            >
              {pending ? "Starting…" : "Remove worktree"}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
