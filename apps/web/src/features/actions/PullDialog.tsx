import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { pullTargets } from "./actionAvailability.ts";
import { useStartBatch } from "./useStartBatch.ts";

import type { Fleet } from "@fleetfrog/protocol/domain/fleet";

import type { PullScope } from "./actionAvailability.ts";

function checkouts(count: number): string {
  return `${count} ${count === 1 ? "checkout" : "checkouts"}`;
}

/** Confirms a pull across several checkouts, saying which will be skipped and why. */
export function PullDialog({
  fleet,
  scope,
  onClose,
}: {
  readonly fleet: Fleet;
  readonly scope: PullScope;
  readonly onClose: () => void;
}) {
  const { start, pending, failure } = useStartBatch();
  const targets = pullTargets(fleet, scope);
  const runnable = targets.filter(({ skip }) => skip === null);
  const skipped = targets.filter(({ skip }) => skip !== null);
  const machineCount = new Set(runnable.map(({ machine }) => machine.id)).size;

  return (
    <Dialog
      title={
        runnable.length === 0
          ? "Nothing to pull"
          : `Pull ${checkouts(runnable.length)} on ${machineCount} ${machineCount === 1 ? "machine" : "machines"}?`
      }
      onClose={onClose}
    >
      <div className="space-y-4 text-sm">
        <p>
          Each checkout fetches, then fast-forwards its branch. A checkout with changes or commits
          to push is left as it is.
        </p>
        {skipped.length > 0 && (
          <div>
            <p className="font-medium">
              {runnable.length === 0
                ? `All ${checkouts(skipped.length)} would be skipped, as of the last scan:`
                : `${checkouts(skipped.length)} will be skipped, as of the last scan:`}
            </p>
            <ul className="mt-2 max-h-64 space-y-1 overflow-auto rounded-md border border-line bg-canvas px-3 py-2">
              {skipped.map(({ repository, machine, checkout, skip }) => (
                <li key={`${machine.id}:${checkout.path}`}>
                  <span className="font-medium">{repository.label}</span> on {machineLabel(machine)}
                  <span className="text-ink-muted">: {skip}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p role="status" className="text-danger">
          {failure}
        </p>
        <div className="flex justify-end gap-3">
          <Button onClick={onClose}>{runnable.length === 0 ? "Close" : "Cancel"}</Button>
          {runnable.length > 0 && (
            <Button
              tone="primary"
              disabled={pending}
              onClick={() => start({ _tag: "Pull", scope }, onClose)}
            >
              {pending ? "Starting…" : `Pull ${checkouts(runnable.length)}`}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
