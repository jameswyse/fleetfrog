import { Schema } from "effect";

import type { Machine } from "./fleet.ts";

/**
 * How updating a machine's agent to the hub's version is going. Every FleetFrog package shares one
 * version, so the hub's own version is the one its agents should run. The hub keeps this in memory,
 * from asking the agent to update until it reconnects.
 */
export const AgentUpdate = Schema.TaggedUnion({
  /** The agent is installing `version` and then restarts on it. */
  Updating: { version: Schema.String, since: Schema.DateTimeUtc },
  Failed: { version: Schema.String, message: Schema.String },
});
export type AgentUpdate = typeof AgentUpdate.Type;

function versionNumbers(version: string): ReadonlyArray<number> {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);

  return match === null ? [0, 0, 0] : match.slice(1).map(Number);
}

/** Orders versions such as `0.1.10` and `0.2.0`: negative when `left` is older than `right`. */
export function compareVersions(left: string, right: string): number {
  const leftNumbers = versionNumbers(left);
  const rightNumbers = versionNumbers(right);
  const index = leftNumbers.findIndex((number, position) => number !== rightNumbers[position]);

  return index === -1 ? 0 : (leftNumbers[index] ?? 0) - (rightNumbers[index] ?? 0);
}

/** Whether the machine's agent runs an older version than the hub. */
export function agentBehindHub(machine: Pick<Machine, "info">, hubVersion: string): boolean {
  return compareVersions(machine.info.agentVersion, hubVersion) < 0;
}

/**
 * Whether the hub can update the machine's agent now: it runs an older version, is online, can
 * replace itself, and isn't already updating.
 */
export function canUpdateAgent(
  machine: Pick<Machine, "info" | "connection" | "update">,
  hubVersion: string,
): boolean {
  return (
    agentBehindHub(machine, hubVersion) &&
    machine.connection._tag === "Online" &&
    machine.connection.capabilities.updatesItself &&
    machine.update?._tag !== "Updating"
  );
}
