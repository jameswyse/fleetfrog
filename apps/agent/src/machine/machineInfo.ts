import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";

import { Effect } from "effect";

import { GithubCli } from "@fleetfrog/protocol/domain/machine";

import packageJson from "../../package.json" with { type: "json" };
import { expandHome } from "../discovery/discoverCheckouts.ts";
import { runCommand } from "../process/runCommand.ts";

import type { MachineInfo, Platform } from "@fleetfrog/protocol/domain/machine";

const commonRoots = ["~/Projects", "~/projects", "~/code", "~/src", "~/dev"];
const prettyHostnameLine = /^PRETTY_HOSTNAME=(?<value>.*)$/m;

export const agentVersion = packageJson.version;

function currentPlatform(): Platform {
  if (process.platform === "linux" || process.platform === "darwin") {
    return process.platform;
  }

  throw new Error(`FleetFrog does not support ${process.platform} yet.`);
}

/** The name the user gave the machine: systemd's pretty hostname on Linux, the computer name on macOS. */
const readPrettyName = Effect.fn("readPrettyName")(function* (platform: Platform) {
  if (platform === "darwin") {
    return yield* runCommand("scutil", homedir(), ["--get", "ComputerName"]).pipe(
      Effect.map((name) => name.trim() || null),
      Effect.orElseSucceed(() => null),
    );
  }

  const machineInfo = yield* Effect.promise(() =>
    readFile("/etc/machine-info", "utf8").catch(() => ""),
  );
  const value = prettyHostnameLine.exec(machineInfo)?.groups?.value?.trim() ?? "";

  return value.replace(/^"(.*)"$/, "$1") || null;
});

const readGithubCli = runCommand("gh", homedir(), ["api", "user", "--jq", ".login"]).pipe(
  Effect.map((login) => GithubCli.cases.Available.make({ login: login.trim() })),
  Effect.orElseSucceed(() =>
    GithubCli.cases.Unavailable.make({ reason: "gh is not installed or not signed in" }),
  ),
);

export const readMachineInfo = Effect.gen(function* () {
  const platform = currentPlatform();

  return {
    hostname: hostname(),
    prettyName: yield* readPrettyName(platform),
    platform,
    homeDirectory: homedir(),
    agentVersion,
    githubCli: yield* readGithubCli,
  } satisfies MachineInfo;
});

/** Common development folders that exist here, offered as the first discovery roots. */
export function suggestDiscoveryRoots(): Array<string> {
  const existing = commonRoots.filter((root) => existsSync(expandHome(root)));

  // Case-insensitive file systems report both spellings of the same folder.
  return existing.includes("~/Projects")
    ? existing.filter((root) => root !== "~/projects")
    : existing;
}
