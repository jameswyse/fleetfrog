import { useEffect, useState } from "react";

import { CircleCheckIcon, TriangleAlertIcon } from "lucide-react";

import { requestHub } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { formatBytes } from "@/ui/formatBytes.ts";
import { plural } from "@/ui/plural.ts";
import { Spinner } from "@/ui/Spinner.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";
import { nothingUnique } from "@fleetfrog/protocol/domain/trash";

import { operationNames } from "../actions/actionCopy.ts";
import { useStartBatch } from "../actions/useStartBatch.ts";
import { busyThreads, cloneFolders, projectsAt } from "../t3Code/t3CodeLookup.ts";
import { BusyThreadsNotice, ProjectFolderNotice } from "../t3Code/T3CodeNotices.tsx";

import type { HubResult } from "@/rpc/hubConnection.ts";
import type { Checkout } from "@fleetfrog/protocol/domain/checkout";
import type { Machine } from "@fleetfrog/protocol/domain/fleet";
import type { Inspection, InspectionResult } from "@fleetfrog/protocol/domain/trash";

type InspectionState =
  | { readonly _tag: "Checking" }
  | { readonly _tag: "Failed"; readonly message: string }
  | { readonly _tag: "Ready"; readonly inspection: Inspection };

function stateFrom(result: HubResult<InspectionResult>): InspectionState {
  if (result._tag === "Failure") {
    return { _tag: "Failed", message: result.message };
  }

  const { value } = result;

  if (value._tag === "Inspected") {
    return { _tag: "Ready", inspection: value.inspection };
  }

  return {
    _tag: "Failed",
    message: value._tag === "Failed" ? value.message : "The machine inspected the wrong thing.",
  };
}

/**
 * The things only this checkout has, each as a short line. It covers every condition
 * `nothingUnique` checks, so permanent deletion is never offered as safe beside a warning.
 */
function uniqueWork(inspection: Inspection): ReadonlyArray<string> {
  const lines: Array<string> = [];

  if (inspection.remote._tag === "Unreachable") {
    lines.push(
      `Its remotes couldn't be fetched (${inspection.remote.message}), so its commits can't be checked against them`,
    );
  }

  if (inspection.remote._tag === "NoRemote") {
    lines.push("It has no remote, so every commit is only here");
  } else if (inspection.unpushedCommits > 0) {
    const branches = inspection.unpushedBranches
      .map(({ name, commits }) => `${name} (${commits})`)
      .join(", ");

    lines.push(
      `${plural(inspection.unpushedCommits, "commit")} on no remote${branches === "" ? "" : `: ${branches}`}`,
    );
  }

  if (inspection.unpushedTags > 0) {
    lines.push(`${plural(inspection.unpushedTags, "tag")} no remote has`);
  }

  if (inspection.operation !== null) {
    lines.push(`${operationNames[inspection.operation]} that isn't finished`);
  }

  if (inspection.submodules > 0) {
    lines.push(
      `${plural(inspection.submodules, "submodule")}, whose own branches and changes aren't checked`,
    );
  }

  if (inspection.stashes > 0) {
    lines.push(plural(inspection.stashes, "stash", "stashes"));
  }

  if (inspection.changedFiles > 0) {
    lines.push(plural(inspection.changedFiles, "changed file"));
  }

  if (inspection.untrackedFiles > 0) {
    lines.push(plural(inspection.untrackedFiles, "untracked file"));
  }

  if (inspection.ignored.total > 0) {
    const examples = inspection.ignored.items
      .slice(0, 4)
      .map(({ path, sizeBytes }) => `${path} (${formatBytes(sizeBytes)})`)
      .join(", ");

    lines.push(
      `${plural(inspection.ignored.total, "ignored file or folder", "ignored files or folders")} that can't be rebuilt, such as ${examples}`,
    );
  }

  return lines;
}

function InspectionSummary({
  inspection,
  machine,
}: {
  readonly inspection: Inspection;
  readonly machine: Machine;
}) {
  const lines = uniqueWork(inspection);

  if (lines.length === 0) {
    return (
      <p className="flex items-start gap-2 rounded-md border border-clean/30 bg-clean/10 px-3 py-2 text-clean">
        <CircleCheckIcon className="mt-0.5 shrink-0" />
        Everything here is on its remote or can be rebuilt.
      </p>
    );
  }

  return (
    <div className="rounded-md border border-changes/40 bg-changes-soft px-3 py-2">
      <p className="flex items-center gap-2 font-medium text-changes">
        <TriangleAlertIcon className="shrink-0" />
        Only {machineLabel(machine)} has:
      </p>
      <ul className="mt-1 ms-6 list-disc space-y-0.5 break-words">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Moves a checkout to the trash, or deletes it for good when nothing in it is unique, after
 * showing what only this machine has. The machine checks everything again before acting.
 */
export function TrashCheckoutDialog({
  label,
  machine,
  checkout,
  onClose,
}: {
  /** The repository's name, for the title. */
  readonly label: string;
  readonly machine: Machine;
  readonly checkout: Checkout;
  readonly onClose: () => void;
}) {
  const { start, pending, failure } = useStartBatch();
  const [state, setState] = useState<InspectionState>({ _tag: "Checking" });
  const [removeCaches, setRemoveCaches] = useState(true);
  const [permanently, setPermanently] = useState(false);

  useEffect(() => {
    let current = true;

    const load = async () => {
      const result = await requestHub((client) =>
        client.InspectCheckout({ machineId: machine.id, path: checkout.path, worktree: null }),
      );

      if (current) {
        setState(stateFrom(result));
      }
    };

    void load();

    return () => {
      current = false;
    };
  }, [machine.id, checkout.path]);

  const inspection = state._tag === "Ready" ? state.inspection : null;
  const worktrees = inspection?.linkedWorktrees ?? 0;
  // Worktrees go to the trash with it, but their work isn't inspected, so deleting them warns.
  const safe = inspection !== null && nothingUnique(inspection) && worktrees === 0;
  const cacheBytes = inspection?.caches.reduce((total, { sizeBytes }) => total + sizeBytes, 0) ?? 0;
  const deleting = permanently && inspection !== null;
  const folders = cloneFolders(checkout);

  const confirm = () => {
    if (inspection === null) {
      return;
    }

    const { fingerprint } = inspection;

    start(
      {
        _tag: "Targeted",
        runs: [
          {
            machineId: machine.id,
            request: deleting
              ? { _tag: "Delete", path: checkout.path, fingerprint, discardUniqueWork: !safe }
              : { _tag: "Trash", path: checkout.path, fingerprint, removeCaches },
          },
        ],
      },
      onClose,
    );
  };

  return (
    <Dialog
      title={
        deleting
          ? `Permanently delete ${label} on ${machineLabel(machine)}?`
          : `Move ${label} on ${machineLabel(machine)} to the trash?`
      }
      onClose={onClose}
    >
      <div className="space-y-4 text-sm">
        <p className="font-mono text-[13px] break-all text-ink-muted">{checkout.path}</p>
        <BusyThreadsNotice
          threads={busyThreads(machine, folders)}
          where={folders.length > 1 ? "in this checkout or its worktrees" : "in this checkout"}
          consequence={
            deleting
              ? "Deleting it removes the files it's working on."
              : "Moving it to the trash takes away the files it's working on."
          }
        />
        <ProjectFolderNotice
          projects={projectsAt(machine, folders)}
          consequence={
            deleting
              ? "Once it's deleted, T3 Code can't open it."
              : "In the trash, T3 Code can't open it until you restore it."
          }
        />
        {state._tag === "Checking" && (
          <p role="status" className="flex items-center gap-2 text-ink-muted">
            <Spinner />
            Checking what only {machineLabel(machine)} has. It fetches from the remotes first, so
            this can take a moment.
          </p>
        )}
        {state._tag === "Failed" && (
          <p role="status" className="text-danger">
            Couldn't check the checkout: {state.message}
          </p>
        )}
        {inspection !== null && (
          <>
            <InspectionSummary inspection={inspection} machine={machine} />
            <p className="text-ink-muted">
              It takes up {formatBytes(inspection.sizeBytes)}
              {cacheBytes > 0 && `, including ${formatBytes(cacheBytes)} of caches`}. The trash
              keeps it whole until you empty the trash, and restoring puts it back here.
            </p>
            {worktrees > 0 && !deleting && (
              <p>
                Its {plural(worktrees, "linked worktree")} {worktrees === 1 ? "goes" : "go"} to the
                trash with it, and {worktrees === 1 ? "comes" : "come"} back with it.
              </p>
            )}
            {
              <fieldset className="min-w-0 space-y-3">
                <legend className="sr-only">Options</legend>
                {inspection.caches.length > 0 && (
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={removeCaches || deleting}
                      disabled={deleting}
                      onChange={(event) => setRemoveCaches(event.currentTarget.checked)}
                      className="mt-0.5 size-4 shrink-0 accent-accent"
                    />
                    <span>
                      Delete caches and dependencies now, freeing {formatBytes(cacheBytes)}
                      <span className="block text-xs text-ink-muted">
                        {inspection.caches
                          .slice(0, 5)
                          .map(({ path }) => path)
                          .join(", ")}
                        {inspection.caches.length > 5 &&
                          ` and ${inspection.caches.length - 5} more`}
                        . Tools rebuild them when needed.
                      </span>
                    </span>
                  </label>
                )}
                <label className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={permanently}
                    onChange={(event) => setPermanently(event.currentTarget.checked)}
                    className="mt-0.5 size-4 shrink-0 accent-accent"
                  />
                  <span>
                    Skip the trash and delete it permanently
                    <span className="block text-xs text-ink-muted">
                      {safe
                        ? "It can be cloned again from its remote."
                        : "It can't be restored afterwards."}
                    </span>
                  </span>
                </label>
                {deleting && !safe && (
                  <p className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-danger">
                    <TriangleAlertIcon className="mt-0.5 shrink-0" />
                    <span>
                      {[
                        !nothingUnique(inspection) &&
                          `What only ${machineLabel(machine)} has, listed above, is lost for good.`,
                        worktrees > 0 &&
                          `Its ${plural(worktrees, "linked worktree")} ${worktrees === 1 ? "is" : "are"} deleted too, without being checked for work of ${worktrees === 1 ? "its" : "their"} own.`,
                      ]
                        .filter((line) => line !== false)
                        .join(" ")}
                    </span>
                  </p>
                )}
              </fieldset>
            }
          </>
        )}
        <p role="status" className="text-danger">
          {failure}
        </p>
        <div className="flex justify-end gap-3">
          <Button onClick={onClose}>Cancel</Button>
          {inspection !== null && (
            <Button tone={deleting ? "danger" : "primary"} disabled={pending} onClick={confirm}>
              {pending && "Starting…"}
              {!pending && (deleting ? "Delete permanently" : "Move to the trash")}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
