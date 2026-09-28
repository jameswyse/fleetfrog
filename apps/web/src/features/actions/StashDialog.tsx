import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { plural } from "@/ui/plural.ts";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { PersonalText } from "../preferences/PersonalText.tsx";
import { busyThreads } from "../t3Code/t3CodeLookup.ts";
import { BusyThreadsNotice } from "../t3Code/T3CodeNotices.tsx";
import { useStartBatch } from "./useStartBatch.ts";

import type { Checkout, GitStatus } from "@fleetfrog/protocol/domain/checkout";
import type { Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

/** Confirms stashing a checkout's changes, which clears them from its working tree. */
export function StashDialog({
  repository,
  machine,
  checkout,
  git,
  onClose,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
  readonly checkout: Checkout;
  readonly git: GitStatus;
  readonly onClose: () => void;
}) {
  const { start, pending, failure } = useStartBatch();
  const files = git.changed.total + git.untracked.total;

  return (
    <Dialog title={`Stash changes in ${repository.label}?`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p>
          {plural(files, "changed file")} on {machineLabel(machine)}, including untracked files,
          move into a new stash and the working tree goes back to its last commit. Ignored files
          stay where they are.
        </p>
        <BusyThreadsNotice
          threads={busyThreads(machine, [checkout.path])}
          where="in this checkout"
          consequence="Stashing takes the changes it's making out of the working tree while it works."
        />
        <p className="text-ink-muted">
          To bring the changes back, run <code className="font-mono">git stash pop</code> in{" "}
          <span className="font-mono break-all">
            <PersonalText>{checkout.path}</PersonalText>
          </span>
          .
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
                    { machineId: machine.id, request: { _tag: "Stash", path: checkout.path } },
                  ],
                },
                onClose,
              )
            }
          >
            {pending ? "Starting…" : `Stash ${plural(files, "file")}`}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
