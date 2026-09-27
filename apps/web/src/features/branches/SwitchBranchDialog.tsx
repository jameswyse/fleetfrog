import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { plural } from "@/ui/plural.ts";

import { useStartBatch } from "../actions/useStartBatch.ts";

import type { Checkout } from "@fleetfrog/protocol/domain/checkout";
import type { Machine } from "@fleetfrog/protocol/domain/fleet";

/** Confirms switching a checkout with changes, which are stashed first rather than carried. */
export function SwitchBranchDialog({
  machine,
  checkout,
  branch,
  changedFiles,
  onClose,
}: {
  readonly machine: Machine;
  readonly checkout: Checkout;
  readonly branch: string;
  readonly changedFiles: number;
  readonly onClose: () => void;
}) {
  const { start, pending, failure } = useStartBatch();

  return (
    <Dialog title={`Stash changes and switch to ${branch}?`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p>
          {plural(changedFiles, "file has", "files have")} changes, which are stashed first so none
          are carried to <span className="font-mono break-all">{branch}</span>. They stay in the
          Stashes list, where you can bring them back. Untracked files stay where they are.
        </p>
        <p role="status" className="text-danger">
          {failure}
        </p>
        <div className="flex justify-end gap-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            tone="primary"
            disabled={pending}
            onClick={() =>
              start(
                {
                  _tag: "Targeted",
                  runs: [
                    {
                      machineId: machine.id,
                      request: {
                        _tag: "Switch",
                        path: checkout.path,
                        branch,
                        stashChanges: true,
                      },
                    },
                  ],
                },
                onClose,
              )
            }
          >
            {pending ? "Starting…" : "Stash and switch"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
