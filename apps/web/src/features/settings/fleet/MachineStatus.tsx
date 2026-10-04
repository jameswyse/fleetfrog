import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { Tier } from "@fleetfrog/protocol/domain/action";
import { agentOutdated } from "@fleetfrog/protocol/domain/actionAvailability";

import { shortProcessorName } from "./systemFormat.ts";

import type { Fleet, Machine } from "@fleetfrog/protocol/domain/fleet";

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

const tierPhrases = {
  git: "Git actions",
  cleanup: "cleanup actions",
  update: "agent updates",
} satisfies Record<Tier, string>;

const tierList = new Intl.ListFormat("en-AU", { type: "conjunction" });

function capitalised(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

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

  const { allowedTiers, updatesItself } = machine.connection.capabilities;
  const tiers = Tier.literals.filter((tier) => tier !== "update" || updatesItself);
  const allowed = tiers.filter((tier) => allowedTiers.includes(tier));
  const denied = tiers.filter((tier) => !allowedTiers.includes(tier));
  const allowedList = tierList.format(allowed.map((tier) => tierPhrases[tier]));

  if (denied.length === 0) {
    return <>{capitalised(allowedList)} allowed</>;
  }

  return (
    <>
      {allowed.length === 0 ? "Nothing allowed" : `Only ${allowedList} allowed`}. To allow the rest,
      run{" "}
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
