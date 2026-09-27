import { useState } from "react";

import { GitBranchIcon } from "lucide-react";

import { knownFleet, useHub, useRuns } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { MachineKindIcon } from "@/ui/MachineKindIcon.tsx";
import { plural } from "@/ui/plural.ts";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { SidebarPage } from "@/ui/SidebarLayout.tsx";
import { machineKind, machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { machineBlocker } from "../actions/actionAvailability.ts";
import { describeActiveRunBriefly } from "../actions/actionCopy.ts";
import { useStartBatch } from "../actions/useStartBatch.ts";
import { trashEntries } from "./trashEntries.ts";

import type { TrashTarget } from "@fleetfrog/protocol/domain/action";
import type { ActionRun, TargetedRun } from "@fleetfrog/protocol/domain/activity";

import type { TrashEntry } from "./trashEntries.ts";

function sameTarget(left: TrashTarget, right: TrashTarget): boolean {
  return left.path === right.path && left.ref === right.ref;
}

/** The queued or running restore or purge of an entry. */
function activeRunOn(active: ReadonlyArray<ActionRun>, entry: TrashEntry): ActionRun | undefined {
  return active.find(
    (run) =>
      run.machineId === entry.machine.id &&
      (run.request._tag === "Restore" || run.request._tag === "Purge") &&
      sameTarget(run.request.target, entry.target),
  );
}

function purgeRuns(entries: ReadonlyArray<TrashEntry>): ReadonlyArray<TargetedRun> {
  return entries.map(({ machine, target }) => ({
    machineId: machine.id,
    request: { _tag: "Purge", target },
  }));
}

/** Confirms permanently deleting entries, which can't be undone. */
function PurgeDialog({
  entries,
  onClose,
}: {
  readonly entries: ReadonlyArray<TrashEntry>;
  readonly onClose: () => void;
}) {
  const { start, pending, failure } = useStartBatch();
  const [first, ...rest] = purgeRuns(entries);
  const only = entries.length === 1 ? entries[0] : undefined;
  const confirmLabel = only === undefined ? "Empty the trash" : "Delete permanently";

  return (
    <Dialog
      title={
        only === undefined ? `Empty the trash?` : `Permanently delete ${only.item.branch.name}?`
      }
      onClose={onClose}
    >
      <div className="space-y-4 text-sm">
        <p>
          {only === undefined
            ? `${plural(entries.length, "item")} will be deleted permanently.`
            : `${only.item.branch.name} will be deleted permanently from ${only.repository.label} on ${machineLabel(only.machine)}.`}{" "}
          Commits that no other branch holds are then removed when Git next cleans up the
          repository. This can't be undone.
        </p>
        <p role="status" className="text-danger">
          {failure}
        </p>
        <div className="flex justify-end gap-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            tone="danger"
            disabled={pending || first === undefined}
            onClick={() => {
              if (first !== undefined) {
                start({ _tag: "Targeted", runs: [first, ...rest] }, onClose);
              }
            }}
          >
            {pending ? "Starting…" : confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function TrashRow({
  entry,
  run,
  onPurge,
}: {
  readonly entry: TrashEntry;
  readonly run: ActionRun | undefined;
  readonly onPurge: () => void;
}) {
  const { start, pending, failure } = useStartBatch();
  const blocked = machineBlocker(entry.machine, "Restore");
  const { branch } = entry.item;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <GitBranchIcon className="shrink-0 text-ink-muted" />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[13px] break-all">{branch.name}</p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted">
          <span>Branch in {entry.repository.label} on</span>
          <MachineKindIcon kind={machineKind(entry.machine)} />
          <span>{machineLabel(entry.machine)}</span>
          <span aria-hidden="true">·</span>
          <span>
            deleted <RelativeTime at={entry.deletedAt} />
          </span>
        </p>
        <p className="truncate text-xs text-ink-muted">
          {branch.sha.slice(0, 7)} {branch.subject}
        </p>
        {failure !== null && (
          <p role="status" className="text-xs text-danger">
            {failure}
          </p>
        )}
      </div>
      {run !== undefined && (
        <span className="text-sm text-sync">{describeActiveRunBriefly(run)}…</span>
      )}
      {run === undefined && blocked !== null && (
        <span className="text-sm text-ink-muted">{blocked}</span>
      )}
      {run === undefined && blocked === null && (
        <div className="flex gap-2">
          <Button
            disabled={pending}
            onClick={() =>
              start({
                _tag: "Targeted",
                runs: [
                  {
                    machineId: entry.machine.id,
                    request: { _tag: "Restore", target: entry.target },
                  },
                ],
              })
            }
          >
            Restore
          </Button>
          <Button tone="quiet" onClick={onPurge}>
            Delete permanently
          </Button>
        </div>
      )}
    </li>
  );
}

/** Everything moved to the trash on every machine, which can be restored until it's emptied. */
export function TrashPage() {
  const fleet = knownFleet(useHub());
  const { active } = useRuns();
  const [purging, setPurging] = useState<ReadonlyArray<TrashEntry> | null>(null);
  const entries = fleet === null ? [] : trashEntries(fleet);
  const purgeable = entries.filter(({ machine }) => machineBlocker(machine, "Purge") === null);

  return (
    <SidebarPage
      title="Trash"
      action={
        purgeable.length > 0 && (
          <Button tone="danger" onClick={() => setPurging(purgeable)}>
            Empty the trash
          </Button>
        )
      }
    >
      <p className="max-w-prose text-sm text-ink-muted">
        Branches FleetFrog deleted stay here until you empty the trash. Restoring one puts it back
        where it was.
      </p>
      {fleet === null && (
        <p className="py-16 text-center text-sm text-ink-muted">Waiting for the hub…</p>
      )}
      {fleet !== null && entries.length === 0 && (
        <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center text-sm">
          <p className="font-medium">The trash is empty</p>
          <p className="mt-1 text-ink-muted">Branches you delete with Tidy branches appear here.</p>
        </div>
      )}
      {entries.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {entries.map((entry) => (
            <TrashRow
              key={entry.key}
              entry={entry}
              run={activeRunOn(active, entry)}
              onPurge={() => setPurging([entry])}
            />
          ))}
        </ul>
      )}
      {purging !== null && <PurgeDialog entries={purging} onClose={() => setPurging(null)} />}
    </SidebarPage>
  );
}
