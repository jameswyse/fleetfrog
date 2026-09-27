import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { useStartBatch } from "../actions/useStartBatch.ts";

import type { Checkout } from "@fleetfrog/protocol/domain/checkout";
import type { Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

/** Confirms moving a checkout into the Archive folder, showing where it will go. */
export function ArchiveDialog({
  repository,
  machine,
  checkout,
  destination,
  onClose,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
  readonly checkout: Checkout;
  readonly destination: string;
  readonly onClose: () => void;
}) {
  const { start, pending, failure } = useStartBatch();

  return (
    <Dialog title={`Archive ${repository.label} on ${machineLabel(machine)}?`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p>The whole folder moves, with its changes, stashes and ignored files:</p>
        <dl className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md border border-line bg-canvas px-3 py-2">
          <dt className="text-ink-muted">From</dt>
          <dd className="font-mono text-[13px] break-all">{checkout.path}</dd>
          <dt className="text-ink-muted">To</dt>
          <dd className="font-mono text-[13px] break-all">{destination}</dd>
        </dl>
        <p className="text-ink-muted">
          It leaves the Projects page and is listed under Cleanup, where you can move it back. Close
          it in any editor or terminal on {machineLabel(machine)} first.
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
                    { machineId: machine.id, request: { _tag: "Archive", path: checkout.path } },
                  ],
                },
                onClose,
              )
            }
          >
            {pending ? "Starting…" : "Archive"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
