import { Link, Outlet } from "@tanstack/react-router";

import { knownFleet, useHub } from "@/rpc/hubConnection.ts";
import { FleetIcon, MachineIcon, PlusIcon, ScanIcon } from "@/ui/icons.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

const linkClass =
  "flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink-muted hover:bg-surface-raised hover:text-ink aria-[current=page]:bg-surface-raised aria-[current=page]:text-ink";

/** The machines in the fleet, nested under it, then a way to add one. */
function MachineLinks() {
  const hub = useHub();
  const machines = knownFleet(hub)?.machines ?? [];

  return (
    <ul className="mt-0.5 space-y-0.5 ps-4">
      {machines.map((machine) => {
        const online = machine.connection._tag === "Online";

        return (
          <li key={machine.id}>
            <Link
              to="/settings/fleet/$machineId"
              params={{ machineId: machine.id }}
              className={linkClass}
            >
              <MachineIcon />
              <span className="min-w-0 flex-1 truncate">{machineLabel(machine)}</span>
              <span
                aria-hidden="true"
                className={`size-2 shrink-0 rounded-full ${online ? "bg-clean" : "bg-ink-muted/60"}`}
              />
              <span className="sr-only">{online ? ", online" : ", offline"}</span>
            </Link>
          </li>
        );
      })}
      <li>
        <Link to="/settings/fleet/pair" className={linkClass}>
          <PlusIcon />
          Pair a machine
        </Link>
      </li>
    </ul>
  );
}

/**
 * Settings sits under the main header with its own sidebar. On wide screens the sidebar stays in
 * place below the header while the page scrolls.
 */
export function SettingsLayout() {
  return (
    <div className="flex flex-col md:flex-row">
      <aside className="border-b border-line bg-surface md:w-64 md:shrink-0 md:border-e md:border-b-0 lg:sticky lg:top-(--app-header-height) lg:h-[calc(100dvh-var(--app-header-height))] lg:overflow-y-auto">
        <nav aria-label="Settings" className="px-3 py-4">
          <ul className="space-y-0.5">
            <li>
              <Link to="/settings/scanning" className={linkClass}>
                <ScanIcon />
                Scanning
              </Link>
            </li>
            <li>
              <Link to="/settings/fleet" activeOptions={{ exact: true }} className={linkClass}>
                <FleetIcon />
                Fleet
              </Link>
              <MachineLinks />
            </li>
          </ul>
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
