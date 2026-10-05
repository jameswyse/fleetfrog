import { useState } from "react";

import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { plural } from "@/ui/plural.ts";

import { ChangesChoice } from "../actions/ChangesChoice.tsx";
import { useStartBatch } from "../actions/useStartBatch.ts";
import { busyThreads } from "../t3Code/t3CodeLookup.ts";
import { BusyThreadsNotice } from "../t3Code/T3CodeNotices.tsx";

import type { Checkout } from "@fleetfrog/protocol/domain/checkout";
import type { Machine } from "@fleetfrog/protocol/domain/fleet";

import type { ChangesHandling } from "../actions/ChangesChoice.tsx";

export function SwitchBranchDialog({
  machine,
  checkout,
  branch,
  changedFiles,
  discardUnavailable,
  onClose,
}: {
  readonly machine: Machine;
  readonly checkout: Checkout;
  readonly branch: string;
  readonly changedFiles: number;
  readonly discardUnavailable: string | null;
  readonly onClose: () => void;
}) {
  const { start, pending, failure } = useStartBatch();
  const [handling, setHandling] = useState<ChangesHandling>("Stash");
  const discarding = handling === "Discard";

  let submitLabel = discarding ? "Discard and switch" : "Stash and switch";

  if (pending) {
    submitLabel = "Starting…";
  }

  return (
    <Dialog title={`Switch to ${branch}?`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p>
          {plural(changedFiles, "file has", "files have")} changes, which are cleared first so none
          are carried to <span className="font-mono break-all">{branch}</span>. Untracked files stay
          where they are.
        </p>
        <ChangesChoice
          machine={machine}
          value={handling}
          onChange={setHandling}
          stash="They go into a new stash, and you can bring them back from the Stashes list."
          discard="They go to the Trash instead of the Stashes list."
          unavailable={discardUnavailable}
        />
        <BusyThreadsNotice
          threads={busyThreads(machine, [checkout.path])}
          where="in this checkout"
          consequence={`Switching ${discarding ? "discards" : "stashes"} the changes it's making and changes the files under it to another branch's.`}
        />
        <p role="status" className="text-danger">
          {failure}
        </p>
        <div className="flex justify-end gap-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            tone={discarding ? "danger" : "primary"}
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
                        discardChanges: discarding,
                      },
                    },
                  ],
                },
                onClose,
              )
            }
          >
            {submitLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
