import { Schema } from "effect";

import { ReportedText } from "./reported.ts";

import type { Connection } from "./fleet.ts";
import type { T3CodeStatus } from "./t3Code.ts";

interface UpdatableT3Code {
  readonly connection: Connection;
  readonly t3Code: T3CodeStatus | null;
  readonly t3CodeUpdate: T3CodeUpdate | null;
}

export const T3CodeChannel = Schema.Literals(["stable", "nightly", "preview"]);
export type T3CodeChannel = typeof T3CodeChannel.Type;

export const T3CodeReleases = Schema.Struct({
  stable: Schema.NullOr(Schema.String),
  nightly: Schema.NullOr(Schema.String),
  preview: Schema.NullOr(Schema.String),
});
export type T3CodeReleases = typeof T3CodeReleases.Type;

export const unknownT3CodeReleases: T3CodeReleases = { stable: null, nightly: null, preview: null };

export const T3CodeUpdate = Schema.TaggedUnion({
  Updating: { version: Schema.String, since: Schema.DateTimeUtc },
  Failed: { version: Schema.String, message: Schema.String },
});
export type T3CodeUpdate = typeof T3CodeUpdate.Type;

export const T3CodeUpdateOutcome = Schema.TaggedUnion({
  Updated: {},
  Failed: { message: ReportedText },
});
export type T3CodeUpdateOutcome = typeof T3CodeUpdateOutcome.Type;

export function t3CodeChannel(version: string): T3CodeChannel {
  const channel = /^[^-+]+-(nightly|preview)\.\d{8}\.\d+$/.exec(version)?.[1];

  return channel === "nightly" || channel === "preview" ? channel : "stable";
}

function versionParts(version: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);

  if (match === null) {
    return null;
  }

  return {
    core: [match[1], match[2], match[3]].map(Number),
    prerelease: match[4]?.split(".") ?? [],
  };
}

function compareIdentifiers(left: string, right: string): number {
  const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
  const rightNumber = /^\d+$/.test(right) ? Number(right) : null;

  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber - rightNumber;
  }

  if (leftNumber !== null || rightNumber !== null) {
    return leftNumber === null ? 1 : -1;
  }

  return left < right ? -1 : left > right ? 1 : 0;
}

export function isNewerT3Code(candidate: string, current: string): boolean {
  const next = versionParts(candidate);
  const running = versionParts(current);

  if (next === null || running === null) {
    return false;
  }

  const coreIndex = next.core.findIndex((part, index) => part !== running.core[index]);

  if (coreIndex !== -1) {
    return (next.core[coreIndex] ?? 0) > (running.core[coreIndex] ?? 0);
  }

  if (next.prerelease.length === 0 || running.prerelease.length === 0) {
    return next.prerelease.length === 0 && running.prerelease.length > 0;
  }

  for (const [index, identifier] of next.prerelease.entries()) {
    const other = running.prerelease[index];

    if (other === undefined) {
      return true;
    }

    const order = compareIdentifiers(identifier, other);

    if (order !== 0) {
      return order > 0;
    }
  }

  return false;
}

export function availableT3CodeVersion(
  t3Code: T3CodeStatus | null,
  releases: T3CodeReleases,
): string | null {
  const running = t3Code?.server?.version ?? null;

  if (running === null) {
    return null;
  }

  const latest = releases[t3CodeChannel(running)];

  return latest !== null && isNewerT3Code(latest, running) ? latest : null;
}

export function outdatedT3Code(fleet: {
  readonly machines: ReadonlyArray<{ readonly t3Code: T3CodeStatus | null }>;
  readonly t3CodeReleases: T3CodeReleases;
}): number {
  return fleet.machines.filter(
    (machine) => availableT3CodeVersion(machine.t3Code, fleet.t3CodeReleases) !== null,
  ).length;
}

export function workingT3CodeThreads(t3Code: T3CodeStatus | null): number {
  const reading = t3Code?.reading;

  return reading?._tag === "Read"
    ? reading.threads.filter((thread) => thread.state === "Working").length
    : 0;
}

export function canUpdateT3Code(machine: UpdatableT3Code, releases: T3CodeReleases): boolean {
  return (
    availableT3CodeVersion(machine.t3Code, releases) !== null &&
    machine.t3Code?.server?.serviceManaged === true &&
    machine.t3Code.reading._tag === "Read" &&
    machine.t3Code.reading.unreadRecords === 0 &&
    machine.connection._tag === "Online" &&
    machine.connection.capabilities.updatesT3Code &&
    machine.connection.capabilities.allowedTiers.includes("t3code") &&
    machine.t3CodeUpdate?._tag !== "Updating" &&
    workingT3CodeThreads(machine.t3Code) === 0
  );
}
