import { plural } from "@/ui/plural.ts";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";
import { schemaDrift, supportedT3CodeSchema } from "@fleetfrog/protocol/domain/t3Code";

import type { Fleet, Machine } from "@fleetfrog/protocol/domain/fleet";
import type { T3CodeSchema } from "@fleetfrog/protocol/domain/t3Code";

export type T3CodeIssue =
  | { readonly _tag: "Unreadable"; readonly machine: Machine; readonly message: string }
  | { readonly _tag: "UnreadRecords"; readonly machine: Machine; readonly count: number }
  | {
      readonly _tag: "Drift";
      readonly machine: Machine;
      readonly schema: T3CodeSchema;
      readonly direction: "Newer" | "Older";
    };

export function t3CodeIssues(fleet: Fleet): ReadonlyArray<T3CodeIssue> {
  return fleet.machines.flatMap((machine): ReadonlyArray<T3CodeIssue> => {
    const reading = machine.t3Code?.reading;

    if (reading === undefined || reading._tag === "NotFound") {
      return [];
    }

    if (reading._tag === "Unreadable") {
      return [{ _tag: "Unreadable", machine, message: reading.message }];
    }

    const direction = schemaDrift(reading.schema);

    return [
      ...(direction === "Current"
        ? []
        : [{ _tag: "Drift", machine, schema: reading.schema, direction } as const]),
      ...(reading.unreadRecords === 0
        ? []
        : [{ _tag: "UnreadRecords", machine, count: reading.unreadRecords } as const]),
    ];
  });
}

export function describeIssue(issue: T3CodeIssue): string {
  const name = machineLabel(issue.machine);

  if (issue._tag === "Unreadable") {
    return `FleetFrog can't read T3 Code on ${name}. ${issue.message}`;
  }

  if (issue._tag === "UnreadRecords") {
    return `FleetFrog couldn't read ${plural(issue.count, "record")} in T3 Code on ${name}, so some projects, threads or icons are missing. T3 Code has probably changed how it stores them, and FleetFrog needs updating.`;
  }

  const age = issue.direction === "Newer" ? "newer" : "older";

  return `T3 Code on ${name} has a ${age} database schema (migration ${issue.schema.migration}) than FleetFrog was built for (migration ${supportedT3CodeSchema.migration}). Check that names, icons and threads look right.`;
}
