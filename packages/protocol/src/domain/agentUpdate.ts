import { Schema } from "effect";

import type { Connection } from "./fleet.ts";
import type { MachineInfo } from "./machine.ts";

interface UpdatableMachine {
  readonly info: Pick<MachineInfo, "agentVersion">;
  readonly connection: Connection;
  readonly update: AgentUpdate | null;
}

export const AgentUpdate = Schema.TaggedUnion({
  Updating: { version: Schema.String, since: Schema.DateTimeUtc },
  Failed: { version: Schema.String, message: Schema.String },
});
export type AgentUpdate = typeof AgentUpdate.Type;

function versionNumbers(version: string): ReadonlyArray<number> {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);

  return match === null ? [0, 0, 0] : match.slice(1).map(Number);
}

export function compareVersions(left: string, right: string): number {
  const leftNumbers = versionNumbers(left);
  const rightNumbers = versionNumbers(right);
  const index = leftNumbers.findIndex((number, position) => number !== rightNumbers[position]);

  return index === -1 ? 0 : (leftNumbers[index] ?? 0) - (rightNumbers[index] ?? 0);
}

export function agentBehindHub(
  machine: Pick<UpdatableMachine, "info">,
  hubVersion: string,
): boolean {
  return compareVersions(machine.info.agentVersion, hubVersion) < 0;
}

export function canUpdateAgent(machine: UpdatableMachine, hubVersion: string): boolean {
  return (
    agentBehindHub(machine, hubVersion) &&
    machine.connection._tag === "Online" &&
    machine.connection.capabilities.updatesItself &&
    machine.connection.capabilities.allowedTiers.includes("update") &&
    machine.update?._tag !== "Updating"
  );
}
