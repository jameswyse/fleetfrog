import { Link } from "@tanstack/react-router";

import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { CheckoutBadges } from "./CheckoutBadges.tsx";
import { checkoutKey, summariseCheckout } from "./checkoutSummary.ts";

import type { Machine, MachineCheckout, Repository } from "@fleetfrog/protocol/domain/fleet";

/** Offline columns sit on the canvas colour so their last known state reads as stale. */
function columnBackground(machine: Machine): string {
  return machine.connection._tag === "Offline" ? "bg-canvas" : "bg-surface";
}

function MachineHeader({ machine }: { readonly machine: Machine }) {
  const label = machineLabel(machine);

  return (
    <th
      scope="col"
      className={`w-64 min-w-56 border-b border-line px-3 py-2.5 text-start align-bottom font-normal ${columnBackground(machine)}`}
    >
      <span className="block truncate font-semibold" title={label}>
        {label}
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
    </th>
  );
}

function CheckoutLink({
  entry,
  offline,
}: {
  readonly entry: MachineCheckout;
  readonly offline: boolean;
}) {
  const summary = summariseCheckout(entry.checkout);
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
      {offline && <span className="sr-only">Last known state, machine offline</span>}
    </Link>
  );
}

function MatrixCell({
  repository,
  machine,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
}) {
  const entries = repository.checkouts.filter(({ machineId }) => machineId === machine.id);
  const offline = machine.connection._tag === "Offline";

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
            <CheckoutLink entry={entry} offline={offline} />
          </li>
        ))}
      </ul>
    </td>
  );
}

/** Repositories down the side, machines across the top, one cell per repository on each machine. */
export function FleetMatrix({
  machines,
  repositories,
}: {
  readonly machines: ReadonlyArray<Machine>;
  readonly repositories: ReadonlyArray<Repository>;
}) {
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
              <MachineHeader key={machine.id} machine={machine} />
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
                <span className="block">{repository.name}</span>
                <span className="block truncate text-xs font-normal text-ink-muted">
                  {repository.identity._tag === "Remote"
                    ? `${repository.identity.host}/${repository.identity.path}`
                    : "Local repository"}
                </span>
              </th>
              {machines.map((machine) => (
                <MatrixCell key={machine.id} repository={repository} machine={machine} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
