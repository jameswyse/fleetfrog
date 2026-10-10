import { plural } from "@/ui/plural.ts";

import type { SystemInfo, SystemUsage } from "@fleetfrog/protocol/domain/machine";

const wholeNumber = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

const twoDecimals = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const percent = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 0,
});

export function formatMemory(bytes: number): string {
  return `${wholeNumber.format(bytes / 1024 ** 3)} GB`;
}

export function formatMemoryInUse(bytes: number): string {
  return `${oneDecimal.format(bytes / 1024 ** 3)} GB`;
}

export function formatDiskSize(bytes: number): string {
  const terabytes = bytes / 1000 ** 4;

  return terabytes >= 1
    ? `${oneDecimal.format(terabytes)} TB`
    : `${wholeNumber.format(bytes / 1000 ** 3)} GB`;
}

export function describeDisk(disk: NonNullable<SystemUsage["disk"]>) {
  const usedBytes = Math.max(0, disk.totalBytes - disk.freeBytes - disk.purgeableBytes);

  return {
    used: formatDiskSize(usedBytes),
    total: formatDiskSize(disk.totalBytes),
    usedShare: usedBytes / disk.totalBytes,
    purgeable:
      disk.purgeableBytes === 0
        ? null
        : {
            amount: formatDiskSize(disk.purgeableBytes),
            share: disk.purgeableBytes / disk.totalBytes,
          },
  };
}

const trademarks = /\((?:R|TM)\)/gi;
const clockSpeed = /\s+CPU\s+@\s+[\d.]+\s*GHz$/i;
const coreCountSuffix = /\s+(?:\d+-Core )?Processor$/i;
const repeatedSpaces = /\s{2,}/g;

export function shortProcessorName(model: string): string {
  return model
    .replace(trademarks, "")
    .replace(clockSpeed, "")
    .replace(coreCountSuffix, "")
    .replace(repeatedSpaces, " ")
    .trim();
}

export function describeProcessorCount(system: SystemInfo): string {
  const { cores } = system.cpu;
  const unit = system.hypervisor === null ? "core" : "vCPU";

  return plural(cores, unit);
}

export function formatLoad(load: number): string {
  return twoDecimals.format(load);
}
