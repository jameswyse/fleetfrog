import { useState } from "react";

import { ArchiveIcon, FolderGit2Icon, GitBranchIcon } from "lucide-react";

import { knownFleet, useHub, useRuns } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { formatBytes } from "@/ui/formatBytes.ts";
import { MachineKindIcon } from "@/ui/MachineKindIcon.tsx";
import { plural } from "@/ui/plural.ts";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { SidebarPage } from "@/ui/SidebarLayout.tsx";
import { machineKind, machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { machineBlocker } from "../actions/actionAvailability.ts";
import { describeActiveRunBriefly } from "../actions/actionCopy.ts";
import { useStartBatch } from "../actions/useStartBatch.ts";
import { sameTarget, trashEntries } from "./trashEntries.ts";

import type { ActionRun, TargetedRun } from "@fleetfrog/protocol/domain/activity";

import type { TrashEntry } from "./trashEntries.ts";

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

/** What an entry is called in sentences, such as the branch or folder name. */
function entryName({ item }: TrashEntry): string {
  if (item._tag === "Stash") {
    return "this stash";
  }

  return item._tag === "Branch" ? item.branch.name : item.checkout.directoryName;
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
  const checkoutBytes = entries.reduce(
    (total, { item }) => total + (item._tag === "Checkout" ? item.checkout.sizeBytes : 0),
    0,
  );
  const hasRefs = entries.some(({ item }) => item._tag !== "Checkout");

  return (
    <Dialog
      title={only === undefined ? "Empty the trash?" : `Permanently delete ${entryName(only)}?`}
      onClose={onClose}
    >
      <div className="space-y-4 text-sm">
        <p>
          {only === undefined
            ? `${plural(entries.length, "item")} will be deleted permanently.`
            : `It will be deleted permanently from ${machineLabel(only.machine)}.`}{" "}
          {checkoutBytes > 0 && `That frees ${formatBytes(checkoutBytes)} of checkouts. `}
          {hasRefs &&
            "Commits nothing else holds are removed when Git next cleans up the repository. "}
          This can't be undone.
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

/** What the row says about the entry under its name. */
function EntryDetails({ entry }: { readonly entry: TrashEntry }) {
  const { item } = entry;
  const where = (
    <>
      <MachineKindIcon kind={machineKind(entry.machine)} />
      <span>{machineLabel(entry.machine)}</span>
      <span aria-hidden="true">·</span>
      <span>
        deleted <RelativeTime at={entry.deletedAt} />
      </span>
    </>
  );

  if (item._tag === "Stash") {
    return (
      <>
        <p className="text-sm break-words">{item.stash.message}</p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted">
          <span>Stash in {entry.repositoryLabel} on</span>
          {where}
        </p>
      </>
    );
  }

  if (item._tag === "Branch") {
    return (
      <>
        <p className="font-mono text-[13px] break-all">{item.branch.name}</p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted">
          <span>Branch in {entry.repositoryLabel} on</span>
          {where}
        </p>
        <p className="truncate text-xs text-ink-muted">
          {item.branch.sha.slice(0, 7)} {item.branch.subject}
        </p>
      </>
    );
  }

  const { checkout } = item;

  return (
    <>
      <p className="text-sm font-medium">{entry.repositoryLabel}</p>
      <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted">
        <span>Checkout on</span>
        {where}
        <span aria-hidden="true">·</span>
        <span>{formatBytes(checkout.sizeBytes)}</span>
      </p>
      <p className="font-mono text-xs break-all text-ink-muted">{checkout.originalPath}</p>
      {checkout.lastCommit !== null && (
        <p className="truncate text-xs text-ink-muted">
          {checkout.branch !== null && <span className="font-mono">{checkout.branch}</span>}{" "}
          {checkout.lastCommit.subject}
        </p>
      )}
    </>
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
  const Icon = { Branch: GitBranchIcon, Stash: ArchiveIcon, Checkout: FolderGit2Icon }[
    entry.item._tag
  ];

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <Icon className="shrink-0 text-ink-muted" />
      <div className="min-w-0 flex-1">
        <EntryDetails entry={entry} />
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
        Checkouts and branches FleetFrog deleted stay here until you empty the trash. Restoring one
        puts it back where it was.
      </p>
      {fleet === null && (
        <p className="py-16 text-center text-sm text-ink-muted">Waiting for the hub…</p>
      )}
      {fleet !== null && entries.length === 0 && (
        <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center text-sm">
          <p className="font-medium">The trash is empty</p>
          <p className="mt-1 text-ink-muted">
            Checkouts you move to the trash, and branches and stashes you delete, appear here.
          </p>
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
