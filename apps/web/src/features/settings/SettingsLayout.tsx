import { Link, Outlet } from "@tanstack/react-router";
import {
  BlocksIcon,
  BrushCleaningIcon,
  CircleFadingArrowUpIcon,
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
import { plural } from "@/ui/plural.ts";
import {
  SidebarLayout,
  sidebarLinkClass,
  sidebarSubmenuClass,
  sidebarSubmenuItemClass,
} from "@/ui/SidebarLayout.tsx";
import { T3CodeLogo } from "@/ui/T3CodeLogo.tsx";
import { agentBehindHub, agentsBehindHub } from "@fleetfrog/protocol/domain/agentUpdate";
import { machineKind, machineLabel } from "@fleetfrog/protocol/domain/fleet";
import { outdatedT3Code } from "@fleetfrog/protocol/domain/t3CodeUpdate";

import { t3CodeNeedsAttention } from "./integrations/t3CodeHealth.ts";

function UpdateAvailableIcon({ label }: { readonly label: string }) {
  return (
    <>
      <CircleFadingArrowUpIcon aria-hidden="true" className="text-changes" />
      <span className="sr-only">, {label}</span>
    </>
  );
}

function FleetLink() {
  const hub = useHub();
  const fleet = knownFleet(hub);
  const behind = fleet === null ? 0 : agentsBehindHub(fleet);

  return (
    <Link to="/settings/fleet" activeOptions={{ exact: true }} className={sidebarLinkClass}>
      <LayersIcon />
      <span className="min-w-0 flex-1 truncate">Fleet</span>
      {behind > 0 && <UpdateAvailableIcon label={`${plural(behind, "agent update")} available`} />}
    </Link>
  );
}

function MachineLinks() {
  const hub = useHub();
  const fleet = knownFleet(hub);
  const machines = fleet?.machines ?? [];

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
              {fleet !== null && agentBehindHub(machine, fleet.hubVersion) && (
                <UpdateAvailableIcon label="agent update available" />
              )}
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
  const attention = fleet !== null && t3CodeNeedsAttention(fleet);
  const outdated = fleet === null ? 0 : outdatedT3Code(fleet);

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
          {!attention && outdated > 0 && (
            <UpdateAvailableIcon label={`${plural(outdated, "T3 Code update")} available`} />
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
              <Link to="/settings/cleanup" className={sidebarLinkClass}>
                <BrushCleaningIcon />
                Cleanup
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
              <FleetLink />
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
