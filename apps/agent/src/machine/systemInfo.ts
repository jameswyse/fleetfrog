import { readFile, statfs } from "node:fs/promises";
import os from "node:os";

import { DateTime, Effect } from "effect";

import { runTool } from "../process/runTool.ts";

import type {
  MachineModel,
  Platform,
  SystemInfo,
  SystemUsage,
} from "@fleetfrog/protocol/domain/machine";

const osReleaseName = /^PRETTY_NAME=(?<value>.*)$/m;
const gitVersionNumber = /git version (?<version>\S+)/;
const productName = /"product-name" = <"(?<name>[^"]+)">/;
const nameAndDetail = /^(?<name>.+?) \((?<detail>.+)\)$/;
const vmStatPageSize = /page size of (?<bytes>\d+) bytes/;
const vmStatCount = /^"?(?<name>[^":\n]+)"?:\s+(?<count>\d+)\.$/gm;

/** The distribution's own name for itself from `/etc/os-release`, such as "Ubuntu 26.04 LTS". */
export function parseOsRelease(text: string): string | null {
  const value = osReleaseName.exec(text)?.groups?.value?.trim() ?? "";

  return value.replace(/^(["'])(.*)\1$/, "$2") || null;
}

/** The version number from `git --version`, such as "2.53.0" from "git version 2.53.0". */
export function parseGitVersion(output: string): string | null {
  return gitVersionNumber.exec(output)?.groups?.version ?? null;
}

/**
 * Memory in use from `vm_stat`, counted as Activity Monitor does: app memory (anonymous pages that
 * can't be purged), wired memory and the compressor's pages. File caches don't count.
 */
export function parseVmStat(output: string): number | null {
  const pageBytes = Number(vmStatPageSize.exec(output)?.groups?.bytes ?? Number.NaN);
  const pages = new Map<string, number>();

  for (const match of output.matchAll(vmStatCount)) {
    const { name, count } = match.groups ?? {};

    if (name !== undefined && count !== undefined) {
      pages.set(name, Number(count));
    }
  }

  const anonymous = pages.get("Anonymous pages");
  const purgeable = pages.get("Pages purgeable");
  const wired = pages.get("Pages wired down");
  const compressed = pages.get("Pages occupied by compressor");

  if (
    !Number.isFinite(pageBytes) ||
    anonymous === undefined ||
    purgeable === undefined ||
    wired === undefined ||
    compressed === undefined
  ) {
    return null;
  }

  return (Math.max(0, anonymous - purgeable) + wired + compressed) * pageBytes;
}

/**
 * The Mac's model from `ioreg`, as About This Mac shows it: "MacBook Pro (13-inch, M1, 2020)"
 * becomes "MacBook Pro" with "13-inch, M1, 2020".
 */
export function parseProductName(output: string): MachineModel | null {
  const full = productName.exec(output)?.groups?.name?.trim();

  if (full === undefined || full === "") {
    return null;
  }

  const parts = nameAndDetail.exec(full)?.groups;

  return parts?.name !== undefined && parts.detail !== undefined
    ? { name: parts.name, detail: parts.detail }
    : { name: full, detail: null };
}

const hypervisorNames = new Map([
  ["kvm", "KVM"],
  ["qemu", "QEMU"],
  ["vmware", "VMware"],
  ["microsoft", "Hyper-V"],
  ["oracle", "VirtualBox"],
  ["xen", "Xen"],
  ["parallels", "Parallels"],
  ["apple", "Apple Virtualization"],
  ["bhyve", "bhyve"],
  ["amazon", "Amazon EC2"],
  ["google", "Google Compute Engine"],
]);

/** The hypervisor's name from `systemd-detect-virt --vm`, or null on a physical machine. */
export function parseHypervisor(output: string): string | null {
  const id = output.trim();

  return id === "" || id === "none" ? null : (hypervisorNames.get(id) ?? id);
}

const readModel = Effect.fn("readModel")(function* (platform: Platform) {
  // Apple silicon Macs name themselves; Linux has no dependable equivalent.
  return platform === "darwin"
    ? yield* runTool("ioreg", os.homedir(), ["-rc", "IOPlatformDevice", "-k", "product-name"]).pipe(
        Effect.map(parseProductName),
        Effect.orElseSucceed(() => null),
      )
    : null;
});

const readHypervisor = Effect.fn("readHypervisor")(function* (platform: Platform) {
  // It exits with a failure on a physical machine, which reads as no hypervisor.
  return platform === "linux"
    ? yield* runTool("systemd-detect-virt", os.homedir(), ["--vm"]).pipe(
        Effect.map(parseHypervisor),
        Effect.orElseSucceed(() => null),
      )
    : null;
});

const readOsName = Effect.fn("readOsName")(function* (platform: Platform) {
  if (platform === "darwin") {
    const [name, version] = yield* Effect.all([
      runTool("sw_vers", os.homedir(), ["-productName"]),
      runTool("sw_vers", os.homedir(), ["-productVersion"]),
    ]).pipe(Effect.orElseSucceed(() => ["macOS", ""]));

    return `${name.trim()} ${version.trim()}`.trim();
  }

  const release = yield* Effect.promise(() => readFile("/etc/os-release", "utf8").catch(() => ""));

  return parseOsRelease(release) ?? "Linux";
});

/** Hardware and software facts, read once per connection. */
export const readSystemInfo = Effect.fn("readSystemInfo")(function* (platform: Platform) {
  const git = yield* runTool("git", os.homedir(), ["--version"]).pipe(
    Effect.map(parseGitVersion),
    Effect.orElseSucceed(() => null),
  );
  const now = yield* DateTime.now;

  return {
    os: yield* readOsName(platform),
    model: yield* readModel(platform),
    hypervisor: yield* readHypervisor(platform),
    architecture: os.arch(),
    cpu: { model: os.cpus()[0]?.model.trim() ?? "Unknown", cores: os.availableParallelism() },
    memoryBytes: os.totalmem(),
    bootedAt: DateTime.subtract(now, { seconds: Math.round(os.uptime()) }),
    versions: { node: process.versions.node, git },
  } satisfies SystemInfo;
});

const readMemoryUsed = Effect.fn("readMemoryUsed")(function* (platform: Platform) {
  if (platform === "darwin") {
    // Free pages alone are a sliver on macOS, which keeps its caches full.
    return yield* runTool("vm_stat", os.homedir(), []).pipe(
      Effect.map(parseVmStat),
      Effect.orElseSucceed(() => null),
    );
  }

  // Node reads MemAvailable on Linux, which leaves out caches the kernel can reclaim.
  return os.totalmem() - os.freemem();
});

/** Disk space for the home directory's file system, memory in use and the load average, now. */
export const readSystemUsage = Effect.fn("readSystemUsage")(function* (platform: Platform) {
  const disk = yield* Effect.promise(() =>
    statfs(os.homedir()).then(
      (stats) => ({
        totalBytes: stats.blocks * stats.bsize,
        // Space an unprivileged user can use, which is what a clone or install can fill.
        freeBytes: stats.bavail * stats.bsize,
      }),
      () => null,
    ),
  );
  const [one = 0, five = 0, fifteen = 0] = os.loadavg();

  return {
    disk,
    memoryUsedBytes: yield* readMemoryUsed(platform),
    loadAverage: [one, five, fifteen],
    sampledAt: yield* DateTime.now,
  } satisfies SystemUsage;
});
