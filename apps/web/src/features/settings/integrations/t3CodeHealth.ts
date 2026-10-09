import { plural } from "@/ui/plural.ts";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";
import { schemaDrift, supportedT3CodeSchema } from "@fleetfrog/protocol/domain/t3Code";

import type { Fleet, Machine } from "@fleetfrog/protocol/domain/fleet";
import type { T3CodeSchema } from "@fleetfrog/protocol/domain/t3Code";

export type T3CodeIssue =
  | {
      readonly _tag: "Unreadable";
      readonly machines: ReadonlyArray<Machine>;
      readonly message: string;
    }
  | {
      readonly _tag: "UnreadRecords";
      readonly machines: ReadonlyArray<Machine>;
      readonly count: number;
    }
  | {
      readonly _tag: "Drift";
      readonly machines: ReadonlyArray<Machine>;
      readonly schema: T3CodeSchema;
      readonly direction: "Newer" | "Older";
    };

const machineNames = new Intl.ListFormat("en-AU", { type: "conjunction" });

function machineIssues(machine: Machine): ReadonlyArray<T3CodeIssue> {
  const reading = machine.t3Code?.reading;
  const machines = [machine];

  if (reading === undefined || reading._tag === "NotFound") {
    return [];
  }

  if (reading._tag === "Unreadable") {
    return [{ _tag: "Unreadable", machines, message: reading.message }];
  }

  const direction = schemaDrift(reading.schema);

  return [
    ...(direction === "Current"
      ? []
      : [{ _tag: "Drift", machines, schema: reading.schema, direction } as const]),
    ...(reading.unreadRecords === 0
      ? []
      : [{ _tag: "UnreadRecords", machines, count: reading.unreadRecords } as const]),
  ];
}

export function issueKey(issue: T3CodeIssue): string {
  if (issue._tag === "Unreadable") {
    return `Unreadable:${issue.message}`;
  }

  return issue._tag === "UnreadRecords"
    ? `UnreadRecords:${issue.count}`
    : `Drift:${issue.schema.migration}`;
}

export function t3CodeIssues(fleet: Fleet): ReadonlyArray<T3CodeIssue> {
  const issues = new Map<string, T3CodeIssue>();

  for (const issue of fleet.machines.flatMap(machineIssues)) {
    const key = issueKey(issue);
    const earlier = issues.get(key);

    issues.set(
      key,
      earlier === undefined
        ? issue
        : { ...earlier, machines: [...earlier.machines, ...issue.machines] },
    );
  }

  return [...issues.values()];
}

export function isProblem(issue: T3CodeIssue): boolean {
  return issue._tag !== "Drift";
}

export function t3CodeNeedsAttention(fleet: Fleet): boolean {
  return t3CodeIssues(fleet).some(isProblem);
}

export function describeIssue(issue: T3CodeIssue): string {
  const names = machineNames.format(issue.machines.map(machineLabel));

  if (issue._tag === "Unreadable") {
    return `FleetFrog can't read T3 Code on ${names}. ${issue.message}`;
  }

  if (issue._tag === "UnreadRecords") {
    const each = issue.machines.length > 1 ? " each" : "";

    return `FleetFrog couldn't read ${plural(issue.count, "record")}${each} in T3 Code on ${names}, so some projects, threads or icons are missing. T3 Code has probably changed how it stores them, and FleetFrog needs updating.`;
  }

  const age = issue.direction === "Newer" ? "a newer" : "an older";
  const remedy = issue.direction === "Newer" ? "FleetFrog needs updating" : "update T3 Code";

  return `T3 Code on ${names} uses ${age} database schema (migration ${issue.schema.migration}) than FleetFrog was built for (migration ${supportedT3CodeSchema.migration}). This is usually fine. If projects, threads or icons look wrong, ${remedy}.`;
}
