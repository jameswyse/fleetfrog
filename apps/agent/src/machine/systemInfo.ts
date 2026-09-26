import { readFile, statfs } from "node:fs/promises";
import os from "node:os";

import { DateTime, Effect } from "effect";

import { runTool } from "../process/runTool.ts";

import type { Platform, SystemInfo, SystemUsage } from "@fleetfrog/protocol/domain/machine";

const osReleaseName = /^PRETTY_NAME=(?<value>.*)$/m;
const gitVersionNumber = /git version (?<version>\S+)/;

/** The distribution's own name for itself from `/etc/os-release`, such as "Ubuntu 26.04 LTS". */
export function parseOsRelease(text: string): string | null {
  const value = osReleaseName.exec(text)?.groups?.value?.trim() ?? "";

  return value.replace(/^(["'])(.*)\1$/, "$2") || null;
}

/** The version number from `git --version`, such as "2.53.0" from "git version 2.53.0". */
export function parseGitVersion(output: string): string | null {
  return gitVersionNumber.exec(output)?.groups?.version ?? null;
}

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
    kernel: `${os.type()} ${os.release()}`,
    architecture: os.arch(),
    cpu: { model: os.cpus()[0]?.model.trim() ?? "Unknown", cores: os.availableParallelism() },
    memoryBytes: os.totalmem(),
    bootedAt: DateTime.subtract(now, { seconds: Math.round(os.uptime()) }),
    versions: { node: process.versions.node, git },
  } satisfies SystemInfo;
});

/** Disk space for the home directory's file system and the load average, as of now. */
export const readSystemUsage = Effect.gen(function* () {
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
    loadAverage: [one, five, fifteen],
    sampledAt: yield* DateTime.now,
  } satisfies SystemUsage;
});
