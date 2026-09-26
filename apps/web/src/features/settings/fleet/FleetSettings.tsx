import { Link } from "@tanstack/react-router";

import { knownFleet, useHub } from "@/rpc/hubConnection.ts";
import { ChevronIcon, MachineIcon } from "@/ui/icons.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { SettingsPage, SettingsSection } from "../SettingsPage.tsx";
import { ConnectionStatus, describePlatform, repositoryCount } from "./MachineStatus.tsx";

const pairLinkClass =
  "inline-flex min-h-9 items-center rounded-md bg-accent px-3 text-sm font-medium text-accent-ink hover:brightness-110";

/** Every paired machine at a glance, each opening its own settings. */
export function FleetSettings() {
  const hub = useHub();
  const fleet = knownFleet(hub);

  return (
    <SettingsPage
      trail={[{ label: "Fleet" }]}
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
        <SettingsSection title="Machines">
          {fleet.machines.map((machine) => {
            const repositories = repositoryCount(fleet, machine);

            return (
              <Link
                key={machine.id}
                to="/settings/fleet/$machineId"
                params={{ machineId: machine.id }}
                className="flex items-center gap-4 px-5 py-4 hover:bg-surface-raised"
              >
                <MachineIcon className="size-5 text-ink-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{machineLabel(machine)}</span>
                  <span className="mt-0.5 block truncate text-sm text-ink-muted">
                    {machine.info.system?.os ?? describePlatform(machine)}
                    {machine.info.system !== null && ` · ${machine.info.system.cpu.model}`} ·{" "}
                    {repositories} {repositories === 1 ? "repository" : "repositories"}
                  </span>
                </span>
                <span className="shrink-0 text-sm">
                  <ConnectionStatus machine={machine} />
                </span>
                <ChevronIcon className="size-4 text-ink-muted" />
              </Link>
            );
          })}
        </SettingsSection>
      )}
    </SettingsPage>
  );
}
