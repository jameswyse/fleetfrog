import { readFile, statfs } from "node:fs/promises";
import os from "node:os";

import { DateTime, Effect } from "effect";

import { runTool } from "../process/runTool.ts";

import type {
  MachineKind,
  MachineModel,
  Platform,
  SystemInfo,
  SystemUsage,
} from "@fleetfrog/protocol/domain/machine";

const osReleaseName = /^PRETTY_NAME=(?<value>.*)$/m;
const gitVersionNumber = /git version (?<version>\S+)/;
const productName = /"product-name" = <"(?<name>[^"]+)">/;
const nameAndDetail = /^(?<name>.+?) \((?<detail>.+)\)$/;
const whitespace = /\s+/g;
const vmStatPageSize = /page size of (?<bytes>\d+) bytes/;
const vmStatCount = /^"?(?<name>[^":\n]+)"?:\s+(?<count>\d+)\.$/gm;
const wholeBytes = /^\d+$/;

const importantCapacityScript = [
  'ObjC.import("Foundation");',
  "function run(argv) {",
  "  const value = Ref();",
  "  $.NSURL.fileURLWithPath(argv[0]).getResourceValueForKeyError(value, $.NSURLVolumeAvailableCapacityForImportantUsageKey, null);",
  "  return ObjC.unwrap(value[0]);",
  "}",
].join("\n");

export function parseOsRelease(text: string): string | null {
  const value = osReleaseName.exec(text)?.groups?.value?.trim() ?? "";

  return value.replace(/^(["'])(.*)\1$/, "$2") || null;
}

export function parseGitVersion(output: string): string | null {
  return gitVersionNumber.exec(output)?.groups?.version ?? null;
}

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

export function parseImportantCapacity(output: string): number | null {
  const value = output.trim();

  return wholeBytes.test(value) ? Number(value) : null;
}

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

export function parseHypervisor(output: string): string | null {
  const id = output.trim();

  return id === "" || id === "none" ? null : (hypervisorNames.get(id) ?? id);
}

export function kindFromAppleName(name: string): MachineKind | null {
  const compact = name.toLowerCase().replace(whitespace, "");

  if (compact.startsWith("macmini")) {
    return "mac-mini";
  }

  if (compact.startsWith("macstudio")) {
    return "mac-studio";
  }

  if (compact.startsWith("macbook")) {
    return "laptop";
  }

  return compact.startsWith("imac") || compact.startsWith("macpro") ? "desktop" : null;
}

const chassisKinds = new Map<string, MachineKind>([
  ["3", "desktop"],
  ["4", "desktop"],
  ["5", "desktop"],
  ["6", "desktop"],
  ["7", "desktop"],
  ["8", "laptop"],
  ["9", "laptop"],
  ["10", "laptop"],
  ["13", "desktop"],
  ["14", "laptop"],
  ["15", "desktop"],
  ["16", "desktop"],
  ["17", "server"],
  ["18", "server"],
  ["19", "server"],
  ["20", "server"],
  ["21", "server"],
  ["22", "server"],
  ["23", "server"],
  ["24", "server"],
  ["28", "server"],
  ["31", "laptop"],
  ["32", "laptop"],
  ["35", "desktop"],
]);

const virtualMarkers = [
  "qemu",
  "kvm",
  "bochs",
  "vmware",
  "virtualbox",
  "innotek",
  "xen",
  "parallels",
  "amazon ec2",
  "google compute engine",
  "digitalocean",
  "hetzner",
  "linode",
  "vultr",
  "scaleway",
  "openstack",
  "cloud",
  "virtual machine",
];

export function kindFromFirmware(firmware: {
  readonly chassisType: string | null;
  readonly vendor: string | null;
  readonly product: string | null;
}): MachineKind | null {
  const product = firmware.product ?? "";
  const vendorAndProduct = `${firmware.vendor ?? ""} ${product}`.toLowerCase();

  if (virtualMarkers.some((marker) => vendorAndProduct.includes(marker))) {
    return "cloud";
  }

  return (
    kindFromAppleName(product) ??
    (firmware.chassisType === null ? null : (chassisKinds.get(firmware.chassisType) ?? null))
  );
}

const readTrimmed = (file: string) =>
  readFile(file, "utf8").then(
    (text) => text.trim() || null,
    () => null,
  );

const readKind = Effect.fn("readKind")(function* (
  platform: Platform,
  model: MachineModel | null,
  hypervisor: string | null,
) {
  if (platform === "darwin") {
    const fromModel = model === null ? null : kindFromAppleName(model.name);

    return (
      fromModel ??
      (yield* runTool("sysctl", os.homedir(), ["-n", "hw.model"]).pipe(
        Effect.map(kindFromAppleName),
        Effect.orElseSucceed(() => null),
      ))
    );
  }

  const [release, chassisType, vendor, product] = yield* Effect.promise(() =>
    Promise.all([
      readTrimmed("/proc/sys/kernel/osrelease"),
      readTrimmed("/sys/class/dmi/id/chassis_type"),
      readTrimmed("/sys/class/dmi/id/sys_vendor"),
      readTrimmed("/sys/class/dmi/id/product_name"),
    ]),
  );

  if (release?.toLowerCase().includes("microsoft") === true) {
    return "linux";
  }

  return hypervisor === null ? kindFromFirmware({ chassisType, vendor, product }) : "cloud";
});

const readModel = Effect.fn("readModel")(function* (platform: Platform) {
  return platform === "darwin"
    ? yield* runTool("ioreg", os.homedir(), ["-rc", "IOPlatformDevice", "-k", "product-name"]).pipe(
        Effect.map(parseProductName),
        Effect.orElseSucceed(() => null),
      )
    : null;
});

const readHypervisor = Effect.fn("readHypervisor")(function* (platform: Platform) {
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

export const readSystemInfo = Effect.fn("readSystemInfo")(function* (platform: Platform) {
  const git = yield* runTool("git", os.homedir(), ["--version"]).pipe(
    Effect.map(parseGitVersion),
    Effect.orElseSucceed(() => null),
  );

  const now = yield* DateTime.now;
  const model = yield* readModel(platform);
  const hypervisor = yield* readHypervisor(platform);

  return {
    os: yield* readOsName(platform),
    model,
    kind: yield* readKind(platform, model, hypervisor),
    hypervisor,
    architecture: os.arch(),
    cpu: { model: os.cpus()[0]?.model.trim() ?? "Unknown", cores: os.availableParallelism() },
    memoryBytes: os.totalmem(),
    bootedAt: DateTime.subtract(now, { seconds: Math.round(os.uptime()) }),
    versions: { node: process.versions.node, git },
  } satisfies SystemInfo;
});

const readMemoryUsed = Effect.fn("readMemoryUsed")(function* (platform: Platform) {
  if (platform === "darwin") {
    return yield* runTool("vm_stat", os.homedir(), []).pipe(
      Effect.map(parseVmStat),
      Effect.orElseSucceed(() => null),
    );
  }

  return os.totalmem() - os.freemem();
});

const readPurgeable = Effect.fn("readPurgeable")(function* (platform: Platform, freeBytes: number) {
  if (platform !== "darwin") {
    return 0;
  }

  const available = yield* runTool("osascript", os.homedir(), [
    "-l",
    "JavaScript",
    "-e",
    importantCapacityScript,
    os.homedir(),
  ]).pipe(
    Effect.map(parseImportantCapacity),
    Effect.orElseSucceed(() => null),
  );

  return available === null ? 0 : Math.max(0, available - freeBytes);
});

const readDisk = Effect.fn("readDisk")(function* (platform: Platform) {
  const stats = yield* Effect.promise(() => statfs(os.homedir()).catch(() => null));

  if (stats === null) {
    return null;
  }

  const freeBytes = stats.bavail * stats.bsize;

  return {
    totalBytes: stats.blocks * stats.bsize,
    freeBytes,
    purgeableBytes: yield* readPurgeable(platform, freeBytes),
  };
});

export const readSystemUsage = Effect.fn("readSystemUsage")(function* (platform: Platform) {
  const disk = yield* readDisk(platform);

  const [one = 0, five = 0, fifteen = 0] = os.loadavg();

  return {
    disk,
    memoryUsedBytes: yield* readMemoryUsed(platform),
    loadAverage: [one, five, fifteen],
    sampledAt: yield* DateTime.now,
  } satisfies SystemUsage;
});
