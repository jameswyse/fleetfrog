import { homedir } from "node:os";
import path from "node:path";

export const instanceVariable = "FLEETFROG_INSTANCE";

export function inheritedEnvironment(): NodeJS.ProcessEnv {
  return process.env;
}

export function currentInstance(): string | undefined {
  return process.env[instanceVariable] || undefined;
}

export function configDirectoryOverride(): string | undefined {
  return process.env.FLEETFROG_CONFIG_DIR;
}

export function executableSearchPath(): string {
  return process.env.PATH ?? "";
}

export function configHome(): string {
  return process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config");
}

export function dataHome(): string {
  return process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share");
}

export function stateHome(): string {
  return process.env.XDG_STATE_HOME ?? path.join(homedir(), ".local", "state");
}

export function t3CodeHome(): string {
  return process.env.T3CODE_HOME ?? path.join(homedir(), ".t3");
}
