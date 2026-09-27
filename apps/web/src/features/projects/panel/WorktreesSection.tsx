import { useState } from "react";

import { GitForkIcon } from "lucide-react";

import { useRuns } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { machineBlocker } from "../../actions/actionAvailability.ts";
import { activeRunFor } from "../../actions/runLookup.ts";
import { useStartBatch } from "../../actions/useStartBatch.ts";
import { PanelSection } from "./PanelSection.tsx";

import type { Checkout, GitStatus, LinkedWorktree } from "@fleetfrog/protocol/domain/checkout";
import type { Machine } from "@fleetfrog/protocol/domain/fleet";

const stateNotes = {
  Present: null,
  Missing: "Folder gone",
  Broken: "Link broken",
} satisfies Record<LinkedWorktree["state"], string | null>;

/** Confirms removing a linked worktree, saying what goes with it. */
function RemoveWorktreeDialog({
  machine,
  checkout,
  worktree,
  onClose,
}: {
  readonly machine: Machine;
  readonly checkout: Checkout;
  readonly worktree: LinkedWorktree;
  readonly onClose: () => void;
}) {
  const { start, pending, failure } = useStartBatch();

  return (
    <Dialog title="Remove this worktree?" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="font-mono text-[13px] break-all text-ink-muted">{worktree.path}</p>
        {worktree.state === "Missing" ? (
          <p>Its folder is already gone, so this only removes Git's record of it.</p>
        ) : (
          <p>
            {worktree.branch === null
              ? "Its commits stay"
              : `Its branch, ${worktree.branch}, stays`}{" "}
            in the repository. The folder is deleted from {machineLabel(machine)}, including files
            Git ignores in it, such as <code>.env</code> or <code>node_modules</code>. A worktree
            with uncommitted changes or untracked files is left alone.
            {worktree.state === "Broken" &&
              " Its link to the repository broke, so it's repaired first."}
          </p>
        )}
        <p role="status" className="text-danger">
          {failure}
        </p>
        <div className="flex justify-end gap-3">
          <Button onClick={onClose}>Cancel</Button>
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
                        path: checkout.path,
                        worktree: worktree.path,
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
        </div>
      </div>
    </Dialog>
  );
}

/** The clone's linked worktrees, as its main checkout lists them, each of which can be removed. */
export function WorktreesSection({
  machine,
  checkout,
  git,
}: {
  readonly machine: Machine;
  readonly checkout: Checkout;
  readonly git: GitStatus;
}) {
  const runs = useRuns();
  const [removing, setRemoving] = useState<LinkedWorktree | null>(null);
  const blocked = machineBlocker(machine, "RemoveWorktree");
  const busy = activeRunFor(runs, { machineId: machine.id, checkout }) !== undefined;

  return (
    <PanelSection
      title="Linked worktrees"
      icon={GitForkIcon}
      tone="neutral"
      count={git.worktrees.length}
    >
      <ul className="space-y-1.5">
        {git.worktrees.map((worktree) => {
          const note = stateNotes[worktree.state];

          return (
            <li key={worktree.path} className="flex items-start gap-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-[13px] break-all">{worktree.path}</span>
                <span className="block text-xs text-ink-muted">
                  {worktree.branch ?? "Detached HEAD"}
                  {note !== null && <span className="text-changes"> · {note}</span>}
                </span>
              </span>
              {blocked === null && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRemoving(worktree)}
                  aria-label={`Remove the worktree at ${worktree.path}`}
                  className="shrink-0 rounded px-1.5 py-0.5 text-xs text-ink-muted hover:bg-canvas hover:text-danger disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Remove
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {blocked !== null && <p className="mt-2 text-xs text-ink-muted">{blocked}.</p>}
      {removing !== null && (
        <RemoveWorktreeDialog
          machine={machine}
          checkout={checkout}
          worktree={removing}
          onClose={() => setRemoving(null)}
        />
      )}
    </PanelSection>
  );
}
