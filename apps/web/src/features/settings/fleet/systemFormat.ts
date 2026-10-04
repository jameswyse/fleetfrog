import { plural } from "@/ui/plural.ts";

import type { SystemInfo } from "@fleetfrog/protocol/domain/machine";

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

/** Memory as it is sold, in binary gigabytes: 64 GB for 64 GiB. */
export function formatMemory(bytes: number): string {
  return `${wholeNumber.format(bytes / 1024 ** 3)} GB`;
}

/** Memory in use, in binary gigabytes to one decimal place, such as 9.6 GB. */
export function formatMemoryInUse(bytes: number): string {
  return `${oneDecimal.format(bytes / 1024 ** 3)} GB`;
}

/** Disk space in decimal units, as macOS and most disk tools show it. */
export function formatDiskSize(bytes: number): string {
  const terabytes = bytes / 1000 ** 4;

  return terabytes >= 1
    ? `${oneDecimal.format(terabytes)} TB`
    : `${wholeNumber.format(bytes / 1000 ** 3)} GB`;
}

const trademarks = /\((?:R|TM)\)/gi;
const clockSpeed = /\s+CPU\s+@\s+[\d.]+\s*GHz$/i;
const coreCountSuffix = /\s+(?:\d+-Core )?Processor$/i;
const repeatedSpaces = /\s{2,}/g;

/**
 * The processor's name without trademark marks, clock speed or the chip's core count, which a
 * virtual machine may not get all of: "AMD EPYC 7302P 16-Core Processor" becomes "AMD EPYC 7302P".
 */
export function shortProcessorName(model: string): string {
  return model
    .replace(trademarks, "")
    .replace(clockSpeed, "")
    .replace(coreCountSuffix, "")
    .replace(repeatedSpaces, " ")
    .trim();
}

/** How many processors work runs on: virtual processors on a virtual machine, cores otherwise. */
export function describeProcessorCount(system: SystemInfo): string {
  const { cores } = system.cpu;
  const unit = system.hypervisor === null ? "core" : "vCPU";

  return plural(cores, unit);
}

export function formatLoad(load: number): string {
  return twoDecimals.format(load);
}
