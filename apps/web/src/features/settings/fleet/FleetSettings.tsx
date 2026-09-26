import { Link, useNavigate } from "@tanstack/react-router";

import { knownFleet, useHub } from "@/rpc/hubConnection.ts";
import { MachineKindIcon } from "@/ui/MachineKindIcon.tsx";
import { SidebarPage } from "@/ui/SidebarLayout.tsx";
import { machineKind, machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { ConnectionText, describeHardware, repositoryCount } from "./MachineStatus.tsx";
import { formatDiskSize, formatMemory, formatMemoryInUse } from "./systemFormat.ts";
import { LoadPills, UsageMeter } from "./SystemMeters.tsx";

import type { Fleet, Machine } from "@fleetfrog/protocol/domain/fleet";

const pairLinkClass =
  "inline-flex min-h-9 items-center rounded-md bg-accent px-3 text-sm font-medium text-accent-ink hover:brightness-110";

const cellClass = "px-4 py-3 align-middle";
const headerClass = "px-4 py-2.5 text-start font-medium";

function MachineRow({ fleet, machine }: { readonly fleet: Fleet; readonly machine: Machine }) {
  const navigate = useNavigate();
  const { system } = machine.info;
  const { usage, connection } = machine;
  const online = connection._tag === "Online";
  // Readings from a machine that is offline are its last ones, so they are shown faded.
  const readingClass = `${cellClass} ${online ? "" : "opacity-60"}`;

  return (
    <tr
      // The name is the keyboard route to the machine; the whole row opens it by pointer.
      onClick={(event) => {
        if (!(event.target instanceof Element && event.target.closest("a") !== null)) {
          void navigate({ to: "/settings/fleet/$machineId", params: { machineId: machine.id } });
        }
      }}
      className="group cursor-pointer hover:bg-surface-raised"
    >
      <th scope="row" className={`${cellClass} text-start font-normal`}>
        <div className="flex items-center gap-3">
          <span className="relative shrink-0">
            <MachineKindIcon kind={machineKind(machine)} className="size-5 text-ink-muted" />
            <span
              aria-hidden="true"
              className={`absolute -end-1 -bottom-1 size-2.5 rounded-full ring-2 ring-surface group-hover:ring-surface-raised ${online ? "bg-clean" : "bg-ink-muted"}`}
            />
          </span>
          <div className="min-w-0">
            <Link
              to="/settings/fleet/$machineId"
              params={{ machineId: machine.id }}
              className="font-medium underline-offset-2 hover:underline"
            >
              {machineLabel(machine)}
            </Link>
            <span className="sr-only">{online ? ", online" : ", offline"}</span>
            <p className="mt-0.5 text-ink-muted">{describeHardware(machine)}</p>
            {!online && (
              <p className="mt-0.5 text-ink-muted">
                <ConnectionText machine={machine} />
              </p>
            )}
          </div>
        </div>
      </th>
      <td className={readingClass}>
        {system !== null && usage !== null && usage.memoryUsedBytes !== null && (
          <UsageMeter
            usedShare={system.memoryBytes === 0 ? 0 : usage.memoryUsedBytes / system.memoryBytes}
            description={`${formatMemoryInUse(usage.memoryUsedBytes)} of ${formatMemory(system.memoryBytes)}`}
          />
        )}
      </td>
      <td className={readingClass}>
        {usage !== null && usage.disk !== null && usage.disk.totalBytes > 0 && (
          <UsageMeter
            usedShare={1 - usage.disk.freeBytes / usage.disk.totalBytes}
            description={`${formatDiskSize(usage.disk.totalBytes - usage.disk.freeBytes)} of ${formatDiskSize(usage.disk.totalBytes)}`}
          />
        )}
      </td>
      <td className={readingClass}>
        {system !== null && usage !== null && (
          <LoadPills loadAverage={usage.loadAverage} cores={system.cpu.cores} labels="Bare" />
        )}
      </td>
      <td className={`${cellClass} text-end tabular-nums`}>{repositoryCount(fleet, machine)}</td>
    </tr>
  );
}

/** Every paired machine side by side, each opening its own settings. */
export function FleetSettings() {
  const hub = useHub();
  const fleet = knownFleet(hub);

  return (
    <SidebarPage
      title="Fleet"
      action={
        <Link to="/settings/fleet/pair" className={pairLinkClass}>
          Pair a machine
        </Link>
      }
    >
      {fleet === null && (
        <p className="py-16 text-center text-sm text-ink-muted">Waiting for the hub…</p>
      )}
      {fleet !== null && fleet.machines.length === 0 && (
        <div className="rounded-xl border border-dashed border-line px-5 py-12 text-center text-sm">
          <p className="font-medium">No machines are paired yet</p>
          <p className="mt-1 text-ink-muted">
            Each machine runs an agent that reports its repositories to this hub.
          </p>
        </div>
      )}
      {fleet !== null && fleet.machines.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-3xl text-sm">
            <caption className="sr-only">
              Paired machines. Open one to see its settings and system.
            </caption>
            <thead className="border-b border-line text-xs text-ink-muted">
              <tr>
                <th scope="col" className={headerClass}>
                  Machine
                </th>
                <th scope="col" className={headerClass}>
                  Memory
                </th>
                <th scope="col" className={headerClass}>
                  Disk
                </th>
                <th scope="col" className={headerClass}>
                  Load (1, 5 and 15 min)
                </th>
                <th scope="col" className={`${headerClass} text-end`}>
                  Repositories
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {fleet.machines.map((machine) => (
                <MachineRow key={machine.id} fleet={fleet} machine={machine} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SidebarPage>
  );
}
