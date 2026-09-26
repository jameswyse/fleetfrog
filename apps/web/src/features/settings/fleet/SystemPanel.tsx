import { DateTime } from "effect";

import { formatDuration } from "@/ui/formatDuration.ts";
import { RelativeTime, useNow } from "@/ui/RelativeTime.tsx";

import { SideDetail, SidePanel } from "../SettingsSection.tsx";
import {
  formatDiskSize,
  formatLoad,
  formatMemory,
  formatMemoryInUse,
  percent,
} from "./systemFormat.ts";

import type { Machine } from "@fleetfrog/protocol/domain/fleet";
import type { SystemUsage } from "@fleetfrog/protocol/domain/machine";

/** The bar's colour at each level of use, from the highest threshold down. */
const usageFills = [
  { from: 0.9, fill: "bg-danger" },
  { from: 0.8, fill: "bg-changes" },
  { from: 0, fill: "bg-clean" },
] as const;

/** How full something is: the amounts above a bar that turns amber from 80% and red from 90%. */
function UsageBar({
  used,
  total,
  usedShare,
}: {
  readonly used: string;
  readonly total: string;
  readonly usedShare: number;
}) {
  const share = Math.min(1, Math.max(0, usedShare));
  const { fill } = usageFills.find(({ from }) => share >= from) ?? usageFills[2];

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span>
          {used} <span className="text-ink-muted">of {total}</span>
        </span>
        <span className="text-ink-muted tabular-nums">{percent.format(share)} used</span>
      </div>
      <div aria-hidden="true" className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${share * 100}%` }} />
      </div>
    </>
  );
}

/**
 * How hard the processor is working, judged per core: below 0.7 leaves room to spare, and from 1
 * work is waiting for a core.
 */
const loadLevels = [
  { level: "light", below: 0.7, tone: "border-clean/30 bg-clean/10 text-clean" },
  { level: "busy", below: 1, tone: "border-changes/30 bg-changes-soft text-changes" },
  {
    level: "overloaded",
    below: Number.POSITIVE_INFINITY,
    tone: "border-danger/30 bg-danger-soft text-danger",
  },
] as const;

function LoadPills({
  loadAverage,
  cores,
}: {
  readonly loadAverage: SystemUsage["loadAverage"];
  readonly cores: number;
}) {
  const [one, five, fifteen] = loadAverage;
  const windows = [
    ["1 min", one],
    ["5 min", five],
    ["15 min", fifteen],
  ] as const;

  return (
    <ul className="flex flex-wrap gap-1.5">
      {windows.map(([window, load]) => {
        const { level, tone } =
          loadLevels.find(({ below }) => load / Math.max(1, cores) < below) ?? loadLevels[2];

        return (
          <li
            key={window}
            title={`${formatLoad(load)} across ${cores} ${cores === 1 ? "core" : "cores"}: ${level}`}
            className={`inline-flex items-baseline gap-1.5 rounded-full border px-2 py-px text-xs ${tone}`}
          >
            <span className="opacity-75">{window}</span>
            <span className="font-medium tabular-nums">{formatLoad(load)}</span>
            <span className="sr-only">, {level}</span>
          </li>
        );
      })}
    </ul>
  );
}

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
      <SideDetail term="Operating system">
        {system.os} <span className="text-ink-muted">· {system.architecture}</span>
      </SideDetail>
      <SideDetail term="Processor">
        {system.cpu.model}{" "}
        <span className="text-ink-muted">
          · {system.cpu.cores} {system.cpu.cores === 1 ? "core" : "cores"}
        </span>
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
          <LoadPills loadAverage={usage.loadAverage} cores={system.cpu.cores} />
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
