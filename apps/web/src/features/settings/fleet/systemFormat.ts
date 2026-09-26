import type { SystemUsage } from "@fleetfrog/protocol/domain/machine";

const wholeNumber = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const twoDecimals = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 0 });

/** Memory as it is sold, in binary gigabytes: 64 GB for 64 GiB. */
export function formatMemory(bytes: number): string {
  return `${wholeNumber.format(bytes / 1024 ** 3)} GB`;
}

/** Disk space in decimal units, as macOS and most disk tools show it. */
export function formatDiskSize(bytes: number): string {
  const terabytes = bytes / 1000 ** 4;

  return terabytes >= 1
    ? `${oneDecimal.format(terabytes)} TB`
    : `${wholeNumber.format(bytes / 1000 ** 3)} GB`;
}

export function describeDisk(disk: NonNullable<SystemUsage["disk"]>): string {
  const used = disk.totalBytes === 0 ? 0 : 1 - disk.freeBytes / disk.totalBytes;

  return `${formatDiskSize(disk.freeBytes)} free of ${formatDiskSize(disk.totalBytes)} (${percent.format(used)} used)`;
}

export function describeLoad(loadAverage: SystemUsage["loadAverage"]): string {
  return loadAverage.map((load) => twoDecimals.format(load)).join(" · ");
}
