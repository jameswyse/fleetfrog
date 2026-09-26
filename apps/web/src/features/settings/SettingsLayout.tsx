import { Link, Outlet } from "@tanstack/react-router";

import { knownFleet, useHub } from "@/rpc/hubConnection.ts";
import { FleetIcon, MachineIcon, PlusIcon, ScanIcon } from "@/ui/icons.tsx";
import { SidebarLayout, sidebarLinkClass } from "@/ui/SidebarLayout.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

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
              className={sidebarLinkClass}
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
        <Link to="/settings/fleet/pair" className={sidebarLinkClass}>
          <PlusIcon />
          Pair a machine
        </Link>
      </li>
    </ul>
  );
}

/** Settings sits under the main header with its own sidebar. */
export function SettingsLayout() {
  return (
    <SidebarLayout
      sidebar={
        <nav aria-label="Settings" className="px-3 py-4">
          <ul className="space-y-0.5">
            <li>
              <Link to="/settings/scanning" className={sidebarLinkClass}>
                <ScanIcon />
                Scanning
              </Link>
            </li>
            <li>
              <Link
                to="/settings/fleet"
                activeOptions={{ exact: true }}
                className={sidebarLinkClass}
              >
                <FleetIcon />
                Fleet
              </Link>
              <MachineLinks />
            </li>
          </ul>
        </nav>
      }
    >
      <Outlet />
    </SidebarLayout>
  );
}
