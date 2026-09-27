import { Link } from "@tanstack/react-router";
import { ArchiveIcon } from "lucide-react";

import { knownFleet, useHub, useRuns } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { MachineKindIcon } from "@/ui/MachineKindIcon.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { SidebarPage } from "@/ui/SidebarLayout.tsx";
import { machineKind, machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { describeActiveRunBriefly } from "../actions/actionCopy.ts";
import { useStartBatch } from "../actions/useStartBatch.ts";
import { planUnarchive } from "../archive/archiveAvailability.ts";

import type { ActionRun } from "@fleetfrog/protocol/domain/activity";
import type { Checkout } from "@fleetfrog/protocol/domain/checkout";
import type { Fleet, Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

interface ArchivedEntry {
  readonly repository: Repository;
  readonly machine: Machine;
  readonly checkout: Checkout;
}

function archivedEntries(fleet: Fleet): ReadonlyArray<ArchivedEntry> {
  const machines = new Map(fleet.machines.map((machine) => [machine.id, machine]));

  return fleet.archive.flatMap((repository) =>
    repository.checkouts.flatMap(({ machineId, checkout }) => {
      const machine = machines.get(machineId);

      return machine === undefined ? [] : [{ repository, machine, checkout }];
    }),
  );
}

function ArchivedRow({
  fleet,
  entry,
  run,
}: {
  readonly fleet: Fleet;
  readonly entry: ArchivedEntry;
  readonly run: ActionRun | undefined;
}) {
  const { start, pending, failure } = useStartBatch();
  const { repository, machine, checkout } = entry;
  const plan = planUnarchive({ fleet, machine, checkout });
  const git = checkout.status._tag === "Read" ? checkout.status.git : null;
  const lastCommit = git?.lastCommit ?? null;
  const { placement } = checkout;

  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
      <ArchiveIcon className="mt-0.5 shrink-0 text-ink-muted" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm">
          <span className="font-medium">{repository.label}</span>
          <span className="text-ink-muted">on</span>
          <MachineKindIcon kind={machineKind(machine)} />
          <span>{machineLabel(machine)}</span>
        </p>
        <p className="font-mono text-xs break-all text-ink-muted">{checkout.path}</p>
        <p className="text-xs text-ink-muted">
          {placement._tag === "Archive" && placement.archivedAt !== null && (
            <>
              Archived <RelativeTime at={placement.archivedAt} />
              {lastCommit !== null && " · "}
            </>
          )}
          {lastCommit !== null && (
            <>
              last commit <RelativeTime at={lastCommit.committedAt} />
              {git?.head._tag === "Branch" && (
                <>
                  {" "}
                  on <span className="font-mono">{git.head.name}</span>
                </>
              )}
            </>
          )}
        </p>
        {plan._tag === "Ready" && (
          <p className="text-xs text-ink-muted">
            Unarchiving moves it to <span className="font-mono break-all">{plan.destination}</span>
          </p>
        )}
        {failure !== null && (
          <p role="status" className="text-xs text-danger">
            {failure}
          </p>
        )}
      </div>
      {run !== undefined && (
        <span className="text-sm text-sync">{describeActiveRunBriefly(run)}…</span>
      )}
      {run === undefined && plan._tag === "Blocked" && (
        <span className="text-sm text-ink-muted">{plan.reason}</span>
      )}
      {run === undefined && plan._tag === "Ready" && (
        <Button
          disabled={pending}
          onClick={() =>
            start({
              _tag: "Targeted",
              runs: [
                { machineId: machine.id, request: { _tag: "Unarchive", path: checkout.path } },
              ],
            })
          }
        >
          Unarchive
        </Button>
      )}
    </li>
  );
}

/** Checkouts moved into the Archive folder on every machine. */
export function ArchivePage() {
  const fleet = knownFleet(useHub());
  const { active } = useRuns();
  const entries = fleet === null ? [] : archivedEntries(fleet);

  return (
    <SidebarPage title="Archive">
      <p className="max-w-prose text-sm text-ink-muted">
        {(fleet?.archiveFolder ?? null) === null ? (
          <>
            Archiving is off.{" "}
            <Link
              to="/settings/archive"
              className="text-accent-text underline-offset-2 hover:underline"
            >
              Set an Archive folder
            </Link>{" "}
            to move checkouts you no longer work on out of your project folders.
          </>
        ) : (
          <>
            Checkouts in <span className="font-mono">{fleet?.archiveFolder}</span> on each machine.
            They stay on disk but leave the Projects page. Archive one from its checkout panel.
          </>
        )}
      </p>
      {fleet === null && (
        <p className="py-16 text-center text-sm text-ink-muted">Waiting for the hub…</p>
      )}
      {fleet !== null && entries.length === 0 && (
        <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center text-sm">
          <p className="font-medium">Nothing is archived</p>
          <p className="mt-1 text-ink-muted">Archived checkouts appear here.</p>
        </div>
      )}
      {fleet !== null && entries.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {entries.map((entry) => (
            <ArchivedRow
              key={`${entry.machine.id}:${entry.checkout.path}`}
              fleet={fleet}
              entry={entry}
              run={active.find(
                (run) => run.machineId === entry.machine.id && run.path === entry.checkout.path,
              )}
            />
          ))}
        </ul>
      )}
    </SidebarPage>
  );
}
