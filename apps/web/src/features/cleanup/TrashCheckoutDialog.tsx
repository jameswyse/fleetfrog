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

import { useStartBatch } from "../actions/useStartBatch.ts";

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

  return result.value._tag === "Failed"
    ? { _tag: "Failed", message: result.value.message }
    : { _tag: "Ready", inspection: result.value.inspection };
}

/**
 * The things only this checkout has, each as a short line. It covers every condition
 * `nothingUnique` checks, so the dialog never offers permanent deletion beside a warning.
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
    lines.push(`A ${inspection.operation} that isn't finished`);
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
        client.InspectCheckout({ machineId: machine.id, path: checkout.path }),
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
  const safe = inspection !== null && nothingUnique(inspection);
  const cacheBytes = inspection?.caches.reduce((total, { sizeBytes }) => total + sizeBytes, 0) ?? 0;
  const worktrees = inspection?.linkedWorktrees ?? 0;

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
            request:
              permanently && safe
                ? { _tag: "Delete", path: checkout.path, fingerprint }
                : { _tag: "Trash", path: checkout.path, fingerprint, removeCaches },
          },
        ],
      },
      onClose,
    );
  };

  return (
    <Dialog title={`Move ${label} on ${machineLabel(machine)} to the trash?`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="font-mono text-[13px] break-all text-ink-muted">{checkout.path}</p>
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
            {worktrees > 0 ? (
              <p className="text-danger">
                Remove its {plural(worktrees, "linked worktree")} first, since moving it would break
                them.
              </p>
            ) : (
              <fieldset className="min-w-0 space-y-3">
                <legend className="sr-only">Options</legend>
                {inspection.caches.length > 0 && (
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={removeCaches || permanently}
                      disabled={permanently}
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
                    disabled={!safe}
                    onChange={(event) => setPermanently(event.currentTarget.checked)}
                    className="mt-0.5 size-4 shrink-0 accent-accent"
                  />
                  <span className={safe ? "" : "text-ink-muted"}>
                    Skip the trash and delete it permanently
                    <span className="block text-xs text-ink-muted">
                      {safe
                        ? "It can be cloned again from its remote."
                        : "Only for a checkout with nothing that exists only here."}
                    </span>
                  </span>
                </label>
              </fieldset>
            )}
          </>
        )}
        <p role="status" className="text-danger">
          {failure}
        </p>
        <div className="flex justify-end gap-3">
          <Button onClick={onClose}>Cancel</Button>
          {inspection !== null && worktrees === 0 && (
            <Button tone={permanently ? "danger" : "primary"} disabled={pending} onClick={confirm}>
              {pending && "Starting…"}
              {!pending && (permanently ? "Delete permanently" : "Move to the trash")}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
