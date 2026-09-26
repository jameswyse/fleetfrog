import { Link } from "@tanstack/react-router";

import { knownFleet, useHub } from "@/rpc/hubConnection.ts";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { SettingsHeading } from "../SettingsHeading.tsx";
import {
  ActionsText,
  ConnectionStatus,
  describePlatform,
  repositoryCount,
} from "./MachineStatus.tsx";

const pairLinkClass =
  "inline-flex min-h-9 items-center rounded-md bg-accent px-3 text-sm font-medium text-accent-ink hover:brightness-110";

/** Every paired machine at a glance, each opening its own settings. */
export function FleetSettings() {
  const hub = useHub();
  const fleet = knownFleet(hub);

  return (
    <div>
      <SettingsHeading
        title="Fleet"
        action={
          <Link to="/settings/fleet/pair" className={pairLinkClass}>
            Pair a machine
          </Link>
        }
      >
        Each paired machine runs an agent that reports its repositories.
      </SettingsHeading>
      {fleet === null && (
        <p className="py-12 text-center text-sm text-ink-muted">Waiting for the hub…</p>
      )}
      {fleet !== null && fleet.machines.length === 0 && (
        <p className="rounded-lg border border-dashed border-line px-5 py-12 text-center text-sm text-ink-muted">
          No machines are paired yet.
        </p>
      )}
      {fleet !== null && fleet.machines.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {fleet.machines.map((machine) => {
            const repositories = repositoryCount(fleet, machine);

            return (
              <li key={machine.id}>
                <Link
                  to="/settings/fleet/$machineId"
                  params={{ machineId: machine.id }}
                  className="block px-5 py-4 hover:bg-surface-raised"
                >
                  <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="font-medium">{machineLabel(machine)}</span>
                    <span className="text-sm">
                      <ConnectionStatus machine={machine} />
                    </span>
                  </span>
                  <span className="mt-1 block text-sm text-ink-muted">
                    <span className="font-mono text-[13px]">{machine.info.hostname}</span> ·{" "}
                    {describePlatform(machine)} · {repositories}{" "}
                    {repositories === 1 ? "repository" : "repositories"} ·{" "}
                    {machine.lastStatusAt === null ? (
                      "not scanned yet"
                    ) : (
                      <>
                        scanned <RelativeTime at={machine.lastStatusAt} />
                      </>
                    )}
                  </span>
                  <span className="mt-1 block text-sm text-ink-muted">
                    <ActionsText machine={machine} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
