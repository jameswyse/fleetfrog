import { Link } from "@tanstack/react-router";

import { useRuns } from "@/rpc/hubConnection.ts";
import { MachineKindIcon } from "@/ui/MachineKindIcon.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { machineKind, machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { activeCloneFor, activeRunFor } from "../actions/runLookup.ts";
import { RunStateText } from "../actions/RunStateText.tsx";
import { CheckoutBadges } from "./CheckoutBadges.tsx";
import { checkoutKey, summariseCheckout } from "./checkoutSummary.ts";
import { MachineActions } from "./MachineActions.tsx";
import { RepositoryActions } from "./RepositoryActions.tsx";

import type { RunsSnapshot } from "@fleetfrog/protocol/domain/activity";
import type { Fleet, Machine, MachineCheckout, Repository } from "@fleetfrog/protocol/domain/fleet";

/** Offline columns sit on the canvas colour so their last known state reads as stale. */
function columnBackground(machine: Machine): string {
  return machine.connection._tag === "Offline" ? "bg-canvas" : "bg-surface";
}

function MachineHeader({ fleet, machine }: { readonly fleet: Fleet; readonly machine: Machine }) {
  const label = machineLabel(machine);

  return (
    <th
      scope="col"
      className={`w-64 min-w-56 border-b border-line px-3 py-2.5 text-start align-bottom font-normal ${columnBackground(machine)}`}
    >
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <span className="flex items-center gap-1.5 font-semibold" title={label}>
            <MachineKindIcon kind={machineKind(machine)} className="text-ink-muted" />
            <span className="truncate">{label}</span>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
            {machine.connection._tag === "Online" ? (
              <span className="flex items-center gap-1.5 text-clean">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-clean" />
                Online
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-ink-muted" />
                Offline
              </span>
            )}
            {machine.lastStatusAt === null ? (
              <span>Not scanned yet</span>
            ) : (
              <span>
                Scanned <RelativeTime at={machine.lastStatusAt} />
              </span>
            )}
          </span>
        </div>
        <MachineActions fleet={fleet} machine={machine} />
      </div>
    </th>
  );
}

function CheckoutLink({
  entry,
  offline,
  runs,
}: {
  readonly entry: MachineCheckout;
  readonly offline: boolean;
  readonly runs: RunsSnapshot;
}) {
  const summary = summariseCheckout(entry.checkout);
  const active = activeRunFor(runs, { machineId: entry.machineId, checkout: entry.checkout });
  const branch = summary._tag === "Read" ? summary.branch : "Status unavailable";
  const worktree = entry.checkout.worktree._tag === "Linked";

  return (
    <Link
      to="/"
      search={(previous) => ({ ...previous, checkout: checkoutKey(entry) })}
      className="block rounded-md px-2 py-1.5 hover:bg-surface-raised"
    >
      <span className="flex items-baseline gap-2">
        <span
          className={`truncate font-mono text-[13px] ${offline ? "text-ink-muted" : ""}`}
          title={entry.checkout.path}
        >
          {branch}
        </span>
        {worktree && <span className="shrink-0 text-xs text-ink-muted">worktree</span>}
      </span>
      <span className="mt-1 flex flex-wrap gap-1">
        <CheckoutBadges summary={summary} />
      </span>
      {active !== undefined && (
        <span className="mt-1 flex text-xs">
          <RunStateText run={active} length="short" />
        </span>
      )}
      {offline && <span className="sr-only">Last known state, machine offline</span>}
    </Link>
  );
}

function MatrixCell({
  repository,
  machine,
  runs,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
  readonly runs: RunsSnapshot;
}) {
  const entries = repository.checkouts.filter(({ machineId }) => machineId === machine.id);
  const offline = machine.connection._tag === "Offline";
  const cloning = activeCloneFor(runs, { machineId: machine.id, repositoryKey: repository.key });

  if (entries.length === 0 && cloning !== undefined) {
    return (
      <td
        className={`border-b border-line px-3 py-2 align-top text-xs ${columnBackground(machine)}`}
      >
        <RunStateText run={cloning} length="short" />
      </td>
    );
  }

  if (entries.length === 0) {
    return (
      <td
        className={`border-b border-line px-3 py-2 align-top text-sm text-ink-muted ${columnBackground(machine)}`}
      >
        {machine.lastDiscoveryAt === null ? (
          <span className="italic">Not scanned</span>
        ) : (
          <>
            <span aria-hidden="true">–</span>
            <span className="sr-only">
              {offline ? "Not on this machine at the last scan" : "Not on this machine"}
            </span>
          </>
        )}
      </td>
    );
  }

  return (
    <td className={`border-b border-line px-1 py-1 align-top ${columnBackground(machine)}`}>
      <ul className="space-y-0.5">
        {entries.map((entry) => (
          <li key={entry.checkout.path}>
            <CheckoutLink entry={entry} offline={offline} runs={runs} />
          </li>
        ))}
      </ul>
    </td>
  );
}

/** Repositories down the side, machines across the top, one cell per repository on each machine. */
export function FleetMatrix({
  fleet,
  repositories,
}: {
  readonly fleet: Fleet;
  /** The repositories to show, which the page may have filtered. */
  readonly repositories: ReadonlyArray<Repository>;
}) {
  const runs = useRuns();
  const { machines } = fleet;

  return (
    <div className="w-fit max-w-full overflow-auto rounded-lg border border-line bg-surface">
      <table className="border-separate border-spacing-0 text-sm">
        <caption className="sr-only">Repositories by machine</caption>
        <thead className="sticky top-0 z-[2]">
          <tr>
            <th
              scope="col"
              className="sticky start-0 z-[3] w-72 min-w-56 border-e border-b border-line bg-surface px-4 py-2.5 text-start align-bottom font-semibold"
            >
              Repository
            </th>
            {machines.map((machine) => (
              <MachineHeader key={machine.id} fleet={fleet} machine={machine} />
            ))}
          </tr>
        </thead>
        <tbody>
          {repositories.map((repository) => (
            <tr key={repository.key}>
              <th
                scope="row"
                className="sticky start-0 z-[1] border-e border-b border-line bg-surface px-4 py-2.5 text-start align-top font-medium"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="block">{repository.name}</span>
                    <span className="block truncate text-xs font-normal text-ink-muted">
                      {repository.identity._tag === "Remote"
                        ? `${repository.identity.host}/${repository.identity.path}`
                        : "Local repository"}
                    </span>
                  </div>
                  <RepositoryActions fleet={fleet} repository={repository} />
                </div>
              </th>
              {machines.map((machine) => (
                <MatrixCell
                  key={machine.id}
                  repository={repository}
                  machine={machine}
                  runs={runs}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
