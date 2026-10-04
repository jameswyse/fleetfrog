import { plural } from "@/ui/plural.ts";
import { schemaDrift } from "@fleetfrog/protocol/domain/t3Code";

import type { Fleet, Machine } from "@fleetfrog/protocol/domain/fleet";
import type { T3CodeProject } from "@fleetfrog/protocol/domain/t3Code";

function checkoutPaths(fleet: Fleet, machine: Machine): ReadonlySet<string> {
  return new Set(
    [...fleet.repositories, ...fleet.archive].flatMap(({ checkouts }) =>
      checkouts.flatMap(({ machineId, checkout }) =>
        machineId === machine.id ? [checkout.path] : [],
      ),
    ),
  );
}

export function unmatchedProjects(fleet: Fleet, machine: Machine): ReadonlyArray<T3CodeProject> {
  const reading = machine.t3Code?.reading;

  if (reading?._tag !== "Read") {
    return [];
  }

  const paths = checkoutPaths(fleet, machine);

  return reading.projects.filter(({ path }) => !paths.has(path));
}

export function ReadingSummary({
  fleet,
  machine,
}: {
  readonly fleet: Fleet;
  readonly machine: Machine;
}) {
  const status = machine.t3Code;

  if (status === null) {
    return (
      <span className="text-ink-muted">
        {machine.connection._tag === "Offline"
          ? "Not read yet. The machine is offline."
          : "Not read yet. If this lasts past the next scan, update the agent."}
      </span>
    );
  }

  const { reading } = status;

  const database = <span className="font-mono text-xs break-all">{status.database}</span>;

  if (reading._tag === "NotFound") {
    return <span className="text-ink-muted">T3 Code isn't installed. There's no {database}.</span>;
  }

  if (reading._tag === "Unreadable") {
    return (
      <span className="text-danger">
        {reading.message} It's at {database}.
      </span>
    );
  }

  const unmatched = unmatchedProjects(fleet, machine).length;
  const working = reading.threads.filter(({ state }) => state !== "Idle").length;

  return (
    <span>
      {plural(reading.projects.length, "project")}
      {unmatched > 0 && `, ${unmatched} without a repository here`}
      {" · "}
      {plural(reading.threadCount, "thread")}
      {working > 0 && `, ${working} in progress`}
    </span>
  );
}

export function SchemaText({ machine }: { readonly machine: Machine }) {
  const reading = machine.t3Code?.reading;
  const schema = reading === undefined || reading._tag === "NotFound" ? null : reading.schema;

  if (schema === null) {
    return <span className="text-ink-muted">Unknown</span>;
  }

  const drift = schemaDrift(schema);

  return (
    <span className={drift === "Current" ? "" : "text-danger"} title={schema.name}>
      Migration {schema.migration}
      {drift !== "Current" &&
        (drift === "Newer" ? ", newer than supported" : ", older than supported")}
    </span>
  );
}
