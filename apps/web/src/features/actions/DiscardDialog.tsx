import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { plural } from "@/ui/plural.ts";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { busyThreads } from "../t3Code/t3CodeLookup.ts";
import { BusyThreadsNotice } from "../t3Code/T3CodeNotices.tsx";
import { DiscardWarning } from "./ChangesChoice.tsx";
import { useStartBatch } from "./useStartBatch.ts";

import type { Checkout, GitStatus } from "@fleetfrog/protocol/domain/checkout";
import type { Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

const shownFiles = 8;

export function DiscardDialog({
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

  const paths = [
    ...git.changed.items.map(({ path }) => path),
    ...git.untracked.items.map((path) => `${path} (untracked)`),
  ].slice(0, shownFiles);

  const parts = [
    git.changed.total > 0 && plural(git.changed.total, "changed file"),
    git.untracked.total > 0 && plural(git.untracked.total, "untracked file"),
  ].filter((part) => part !== false);

  return (
    <Dialog title={`Discard changes in ${repository.label}?`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p>
          {parts.join(" and ")} on {machineLabel(machine)} {files === 1 ? "is" : "are"} discarded,
          and the working tree goes back to its last commit. Ignored files stay where they are.
        </p>
        <ul className="max-h-48 overflow-auto rounded-md border border-line px-3 py-2">
          {paths.map((path) => (
            <li key={path} className="font-mono text-[13px] break-all">
              {path}
            </li>
          ))}
          {files > paths.length && (
            <li className="text-ink-muted">and {files - paths.length} more</li>
          )}
        </ul>
        <BusyThreadsNotice
          threads={busyThreads(machine, [checkout.path])}
          where="in this checkout"
          consequence="Discarding throws away the changes it's making while it works."
        />
        <DiscardWarning />
        <p role="status" className="text-danger">
          {failure}
        </p>
        <div className="flex justify-end gap-3">
          <Button data-autofocus onClick={onClose}>
            Cancel
          </Button>
          <Button
            tone="danger"
            disabled={pending}
            onClick={() =>
              start(
                {
                  _tag: "Targeted",
                  runs: [
                    { machineId: machine.id, request: { _tag: "Discard", path: checkout.path } },
                  ],
                },
                onClose,
              )
            }
          >
            {pending ? "Starting…" : `Discard ${plural(files, "file")}`}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
