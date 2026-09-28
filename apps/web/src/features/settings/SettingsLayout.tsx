import { Link, Outlet } from "@tanstack/react-router";
import {
  BlocksIcon,
  KeyRoundIcon,
  LayersIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  UsersIcon,
} from "lucide-react";

import { knownFleet, useHub } from "@/rpc/hubConnection.ts";
import { MachineKindIcon } from "@/ui/MachineKindIcon.tsx";
import {
  SidebarLayout,
  sidebarLinkClass,
  sidebarSubmenuClass,
  sidebarSubmenuItemClass,
} from "@/ui/SidebarLayout.tsx";
import { T3CodeLogo } from "@/ui/T3CodeLogo.tsx";
import { machineKind, machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { t3CodeIssues } from "./integrations/t3CodeHealth.ts";

function MachineLinks() {
  const hub = useHub();
  const machines = knownFleet(hub)?.machines ?? [];

  return (
    <ul className={sidebarSubmenuClass}>
      {machines.map((machine) => {
        const online = machine.connection._tag === "Online";

        return (
          <li key={machine.id} className={sidebarSubmenuItemClass}>
            <Link
              to="/settings/fleet/$machineId"
              params={{ machineId: machine.id }}
              className={sidebarLinkClass}
            >
              <MachineKindIcon kind={machineKind(machine)} />
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
      <li className={sidebarSubmenuItemClass}>
        <Link to="/settings/fleet/pair" className={sidebarLinkClass}>
          <PlusIcon />
          Pair a machine
        </Link>
      </li>
    </ul>
  );
}

function IntegrationLinks() {
  const hub = useHub();
  const fleet = knownFleet(hub);
  const attention = fleet !== null && t3CodeIssues(fleet).length > 0;

  return (
    <ul className={sidebarSubmenuClass}>
      <li className={sidebarSubmenuItemClass}>
        <Link to="/settings/integrations/t3-code" className={sidebarLinkClass}>
          <T3CodeLogo />
          <span className="min-w-0 flex-1 truncate">T3 Code</span>
          {attention && (
            <>
              <TriangleAlertIcon aria-hidden="true" className="text-danger" />
              <span className="sr-only">, needs attention</span>
            </>
          )}
        </Link>
      </li>
    </ul>
  );
}

export function SettingsLayout() {
  return (
    <SidebarLayout
      sidebar={
        <nav aria-label="Settings" className="px-3 py-4">
          <ul className="space-y-0.5">
            <li>
              <Link to="/settings/scanning" className={sidebarLinkClass}>
                <RefreshCwIcon />
                Scanning
              </Link>
            </li>
            <li>
              <Link
                to="/settings/authentication"
                activeOptions={{ exact: true }}
                className={sidebarLinkClass}
              >
                <KeyRoundIcon />
                Authentication
              </Link>
              <ul className={sidebarSubmenuClass}>
                <li className={sidebarSubmenuItemClass}>
                  <Link to="/settings/authentication/users" className={sidebarLinkClass}>
                    <UsersIcon />
                    Users
                  </Link>
                </li>
                <li className={sidebarSubmenuItemClass}>
                  <Link to="/settings/authentication/oidc" className={sidebarLinkClass}>
                    <ShieldCheckIcon />
                    OpenID Connect
                  </Link>
                </li>
              </ul>
            </li>
            <li>
              <Link
                to="/settings/integrations"
                activeOptions={{ exact: true }}
                className={sidebarLinkClass}
              >
                <BlocksIcon />
                Integrations
              </Link>
              <IntegrationLinks />
            </li>
            <li>
              <Link
                to="/settings/fleet"
                activeOptions={{ exact: true }}
                className={sidebarLinkClass}
              >
                <LayersIcon />
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
