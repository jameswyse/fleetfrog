import { BotIcon } from "lucide-react";

import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { plural } from "@/ui/plural.ts";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { busyThreads } from "../t3Code/t3CodeLookup.ts";
import { threadDoing } from "../t3Code/T3CodeNotices.tsx";
import { pullTargets } from "./actionAvailability.ts";
import { useStartBatch } from "./useStartBatch.ts";

import type { Fleet } from "@fleetfrog/protocol/domain/fleet";

import type { PullScope } from "./actionAvailability.ts";

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

  const underAgents = runnable.flatMap((target) => {
    const [thread] = busyThreads(target.machine, [target.checkout.path]);

    return thread === undefined ? [] : [{ ...target, thread }];
  });

  return (
    <Dialog
      title={
        runnable.length === 0
          ? "Nothing to pull"
          : `Pull ${plural(runnable.length, "checkout")} on ${plural(machineCount, "machine")}?`
      }
      onClose={onClose}
    >
      <div className="space-y-4 text-sm">
        <p>
          Each checkout fetches, then fast-forwards its branch. A checkout with changes or commits
          to push is left as it is.
        </p>
        {underAgents.length > 0 && (
          <div className="rounded-xl border border-sync/30 bg-sync-soft px-3 py-2.5">
            <p className="flex items-start gap-2">
              <BotIcon aria-hidden="true" className="mt-0.5 text-sync" />
              {underAgents.length === 1
                ? "T3 Code is working in one of these checkouts, which will be pulled too:"
                : `T3 Code is working in ${underAgents.length} of these checkouts, which will be pulled too:`}
            </p>
            <ul className="mt-2 space-y-1 ps-6">
              {underAgents.map(({ repository, machine, checkout, thread }) => (
                <li key={`${machine.id}:${checkout.path}`}>
                  <span className="font-medium">{repository.label}</span> on {machineLabel(machine)}
                  <span className="text-ink-muted">
                    : “{thread.title}” {threadDoing(thread)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {skipped.length > 0 && (
          <div>
            <p className="font-medium">
              {runnable.length === 0
                ? `All ${plural(skipped.length, "checkout")} would be skipped, as of the last scan:`
                : `${plural(skipped.length, "checkout")} will be skipped, as of the last scan:`}
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
              {pending ? "Starting…" : `Pull ${plural(runnable.length, "checkout")}`}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
