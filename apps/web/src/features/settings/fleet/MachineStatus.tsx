import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { agentOutdated } from "@fleetfrog/protocol/domain/actionAvailability";

import { machineBlocker } from "../../actions/actionAvailability.ts";
import { shortProcessorName } from "./systemFormat.ts";

import type { Fleet, Machine } from "@fleetfrog/protocol/domain/fleet";

/** Whether the machine is connected, and since or until when. */
export function ConnectionStatus({ machine }: { readonly machine: Machine }) {
  const { connection } = machine;
  const online = connection._tag === "Online";

  return (
    <span className={`flex items-center gap-2 ${online ? "text-clean" : "text-ink-muted"}`}>
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 rounded-full ${online ? "bg-clean" : "bg-ink-muted"}`}
      />
      <span>
        {connection._tag === "Online" && (
          <>
            Online since <RelativeTime at={connection.since} />
          </>
        )}
        {connection._tag === "Offline" && connection.lastSeenAt === null && "Never connected"}
        {connection._tag === "Offline" && connection.lastSeenAt !== null && (
          <>
            Offline, last seen <RelativeTime at={connection.lastSeenAt} />
          </>
        )}
      </span>
    </span>
  );
}

/** What the hub may ask this machine to do, as its owner's policy allows. */
export function ActionsText({ machine }: { readonly machine: Machine }) {
  if (machine.connection._tag === "Offline") {
    return <>Known when the machine is online</>;
  }

  if (agentOutdated(machine.connection.capabilities)) {
    return <>The agent needs updating</>;
  }

  if (!machine.connection.capabilities.policyReadable) {
    return (
      <>
        None. The policy file on this machine can't be read. To replace it, run{" "}
        <code>fleetfrog allow git</code> there.
      </>
    );
  }

  if (machineBlocker(machine, "Fetch") === null) {
    return <>Git actions allowed</>;
  }

  return (
    <>
      Git actions turned off. To allow them, run <code>fleetfrog allow git</code> on the machine.
    </>
  );
}

/** How many repositories have at least one checkout on the machine. */
export function repositoryCount(fleet: Fleet, machine: Machine): number {
  return fleet.repositories.filter(({ checkouts }) =>
    checkouts.some(({ machineId }) => machineId === machine.id),
  ).length;
}

export function describePlatform(machine: Machine): string {
  return machine.info.platform === "darwin" ? "macOS" : "Linux";
}

/** What the machine is, briefly: its model, processor and operating system. */
export function describeHardware(machine: Machine): string {
  const { system } = machine.info;

  if (system === null) {
    return describePlatform(machine);
  }

  const kind = system.model?.name ?? (system.hypervisor === null ? null : "Virtual machine");

  return [kind, shortProcessorName(system.cpu.model), system.os]
    .filter((part) => part !== null)
    .join(" · ");
}
