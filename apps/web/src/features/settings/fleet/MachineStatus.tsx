import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { Tier } from "@fleetfrog/protocol/domain/action";
import { agentOutdated } from "@fleetfrog/protocol/domain/actionAvailability";

import { shortProcessorName } from "./systemFormat.ts";

import type { Fleet, Machine } from "@fleetfrog/protocol/domain/fleet";

/** Whether the machine is connected, and since or until when, in words. */
export function ConnectionText({ machine }: { readonly machine: Machine }) {
  const { connection } = machine;

  if (connection._tag === "Online") {
    return (
      <>
        Online since <RelativeTime at={connection.since} />
      </>
    );
  }

  return connection.lastSeenAt === null ? (
    "Never connected"
  ) : (
    <>
      Offline, last seen <RelativeTime at={connection.lastSeenAt} />
    </>
  );
}

/** Whether the machine is connected, with a coloured dot. */
export function ConnectionStatus({ machine }: { readonly machine: Machine }) {
  const online = machine.connection._tag === "Online";

  return (
    <span className={`flex items-center gap-2 ${online ? "text-clean" : "text-ink-muted"}`}>
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 rounded-full ${online ? "bg-clean" : "bg-ink-muted"}`}
      />
      <span>
        <ConnectionText machine={machine} />
      </span>
    </span>
  );
}

const tierNames = { git: "Git", cleanup: "cleanup" } satisfies Record<Tier, string>;

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

  const { allowedTiers } = machine.connection.capabilities;
  const denied = Tier.literals.filter((tier) => !allowedTiers.includes(tier));
  const [only] = Tier.literals.filter((tier) => allowedTiers.includes(tier));

  if (denied.length === 0) {
    return <>Git and cleanup actions allowed</>;
  }

  return (
    <>
      {only === undefined ? "No actions allowed" : `Only ${tierNames[only]} actions allowed`}. To
      allow the rest, run{" "}
      {denied.map((tier, index) => (
        <span key={tier}>
          {index > 0 && " and "}
          <code>fleetfrog allow {tier}</code>
        </span>
      ))}{" "}
      on the machine.
    </>
  );
}

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
