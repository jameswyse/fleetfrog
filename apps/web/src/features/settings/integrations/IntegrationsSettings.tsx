import { Link } from "@tanstack/react-router";

import { knownFleet, useHub } from "@/rpc/hubConnection.ts";
import { SidebarPage } from "@/ui/SidebarLayout.tsx";

import { SettingsRow, SettingsSection } from "../SettingsSection.tsx";
import { t3CodeIssues } from "./t3CodeHealth.ts";

import type { Fleet } from "@fleetfrog/protocol/domain/fleet";

function T3CodeState({ fleet }: { readonly fleet: Fleet }) {
  if (!fleet.integrations.t3Code.enabled) {
    return <span className="text-ink-muted">Off</span>;
  }

  const issues = t3CodeIssues(fleet).length;

  return issues === 0 ? (
    <span className="text-clean">On</span>
  ) : (
    <span className="text-danger">On, needs attention</span>
  );
}

/** Other apps FleetFrog reads, each opening its own settings. */
export function IntegrationsSettings() {
  const hub = useHub();
  const fleet = knownFleet(hub);

  return (
    <SidebarPage title="Integrations">
      {fleet === null ? (
        <p className="py-16 text-center text-sm text-ink-muted">Waiting for the hub…</p>
      ) : (
        <SettingsSection title="Apps">
          <SettingsRow
            title={
              <Link
                to="/settings/integrations/t3-code"
                className="underline-offset-2 hover:underline"
              >
                T3 Code
              </Link>
            }
            description="Shows T3 Code's names and icons for repositories, and checks its database schema on every machine."
            control={<T3CodeState fleet={fleet} />}
          />
        </SettingsSection>
      )}
    </SidebarPage>
  );
}
