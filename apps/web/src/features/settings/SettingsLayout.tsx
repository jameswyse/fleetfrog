import { Link, Outlet } from "@tanstack/react-router";

import { knownFleet, useHub } from "@/rpc/hubConnection.ts";
import { BackIcon, FleetIcon, MachineIcon, PlusIcon, ScanIcon } from "@/ui/icons.tsx";
import { Logo } from "@/ui/Logo.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { StaleNotice } from "../shell/StaleNotice.tsx";

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
 * Settings fills the window with its own sidebar in place of the main header, so each section and
 * each machine has room for its own page.
 */
export function SettingsLayout() {
  const hub = useHub();

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-10 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="flex flex-col border-b border-line bg-surface md:sticky md:top-0 md:h-dvh md:w-64 md:shrink-0 md:overflow-y-auto md:border-e md:border-b-0">
        <div className="flex min-h-14 items-center px-5">
          <Link to="/" className="flex rounded-md" aria-label="FleetFrog overview">
            <Logo className="h-6 w-auto" />
          </Link>
        </div>
        <nav aria-label="Settings" className="flex-1 px-3 py-2">
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
        <div className="px-3 py-3">
          <Link to="/" className={linkClass}>
            <BackIcon />
            Back
          </Link>
        </div>
      </aside>
      <main id="content" className="min-w-0 flex-1">
        <StaleNotice hub={hub} />
        <Outlet />
      </main>
    </div>
  );
}
