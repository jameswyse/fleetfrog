import { DateTime } from "effect";

import { formatDuration } from "@/ui/formatDuration.ts";
import { RelativeTime, useNow } from "@/ui/RelativeTime.tsx";

import { SideDetail, SidePanel } from "../SettingsSection.tsx";
import {
  describeProcessorCount,
  formatDiskSize,
  formatMemory,
  formatMemoryInUse,
  shortProcessorName,
} from "./systemFormat.ts";
import { LoadPills, UsageBar } from "./SystemMeters.tsx";

import type { Machine } from "@fleetfrog/protocol/domain/fleet";

/** How long the machine has been up: until now while it's connected, or until it was last seen. */
function Uptime({
  machine,
  bootedAt,
}: {
  readonly machine: Machine;
  readonly bootedAt: DateTime.Utc;
}) {
  const now = useNow();
  const { connection } = machine;
  const booted = DateTime.toEpochMillis(bootedAt);

  if (connection._tag === "Online") {
    return formatDuration(now - booted);
  }

  return connection.lastSeenAt === null
    ? "Unknown while offline"
    : `${formatDuration(DateTime.toEpochMillis(connection.lastSeenAt) - booted)} when last seen`;
}

/** Hardware, software and resources as the agent last reported them, for the side column. */
export function SystemPanel({ machine }: { readonly machine: Machine }) {
  const { system } = machine.info;
  const { usage } = machine;

  if (system === null) {
    return (
      <SidePanel title="System">
        <SideDetail term="Not available">
          This machine's agent is too old to report its system. Update the agent to see its
          processor, memory, disk and versions.
        </SideDetail>
      </SidePanel>
    );
  }

  return (
    <SidePanel title="System">
      {system.model !== null && (
        <SideDetail term="Model">
          {system.model.name}
          {system.model.detail !== null && (
            <span className="block text-ink-muted">{system.model.detail}</span>
          )}
        </SideDetail>
      )}
      {system.model === null && system.hypervisor !== null && (
        <SideDetail term="Model">
          Virtual machine <span className="text-ink-muted">· {system.hypervisor}</span>
        </SideDetail>
      )}
      <SideDetail term="Operating system">
        {system.os} <span className="text-ink-muted">· {system.architecture}</span>
      </SideDetail>
      <SideDetail term="Processor">
        <span title={system.cpu.model}>{shortProcessorName(system.cpu.model)}</span>{" "}
        <span className="text-ink-muted">· {describeProcessorCount(system)}</span>
      </SideDetail>
      <SideDetail term="Memory">
        {usage === null || usage.memoryUsedBytes === null || system.memoryBytes === 0 ? (
          <>
            {formatMemory(system.memoryBytes)}{" "}
            <span className="text-ink-muted">· use not reported yet</span>
          </>
        ) : (
          <UsageBar
            used={formatMemoryInUse(usage.memoryUsedBytes)}
            total={formatMemory(system.memoryBytes)}
            usedShare={usage.memoryUsedBytes / system.memoryBytes}
          />
        )}
      </SideDetail>
      <SideDetail term="Disk">
        {usage === null || usage.disk === null || usage.disk.totalBytes === 0 ? (
          "Not reported yet"
        ) : (
          <UsageBar
            used={formatDiskSize(usage.disk.totalBytes - usage.disk.freeBytes)}
            total={formatDiskSize(usage.disk.totalBytes)}
            usedShare={1 - usage.disk.freeBytes / usage.disk.totalBytes}
          />
        )}
      </SideDetail>
      <SideDetail term="Load average">
        {usage === null ? (
          "Not reported yet"
        ) : (
          <LoadPills loadAverage={usage.loadAverage} cores={system.cpu.cores} labels="Labelled" />
        )}
      </SideDetail>
      <SideDetail term="Uptime">
        <Uptime machine={machine} bootedAt={system.bootedAt} />
      </SideDetail>
      <SideDetail term="Versions">
        Agent {machine.info.agentVersion} · Node {system.versions.node}
        {system.versions.git !== null && ` · Git ${system.versions.git}`}
      </SideDetail>
      {usage !== null && (
        <p className="text-xs text-ink-muted">
          {machine.connection._tag === "Offline"
            ? "Memory, disk and load last measured"
            : "Memory, disk and load measured"}{" "}
          <RelativeTime at={usage.sampledAt} />
        </p>
      )}
    </SidePanel>
  );
}
