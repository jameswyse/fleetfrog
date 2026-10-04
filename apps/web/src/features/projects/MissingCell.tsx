import { CircleDashedIcon } from "lucide-react";

import { RunActivity } from "../actions/RunActivity.tsx";
import { activeCloneFor, latestCloneFor } from "../actions/runLookup.ts";

import type { RunsSnapshot } from "@fleetfrog/protocol/domain/activity";
import type { Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

export function MissingCellContent({
  repository,
  machine,
  runs,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
  readonly runs: RunsSnapshot;
}) {
  const target = { machineId: machine.id, repositoryKey: repository.key };
  const cloning = activeCloneFor(runs, target);

  if (machine.lastDiscoveryAt === null) {
    return <span className="text-ink-muted italic">Not scanned</span>;
  }

  if (cloning !== undefined) {
    return (
      <span className="w-full min-w-0 text-xs">
        <RunActivity run={cloning} layout="Stacked" align="Center" />
      </span>
    );
  }

  const last = latestCloneFor(runs, target);

  if (last?.state._tag === "Finished" && last.state.outcome._tag !== "Succeeded") {
    return <span className="text-xs font-medium text-danger">Clone failed</span>;
  }

  return (
    <>
      <CircleDashedIcon aria-hidden="true" className="text-ink-muted/40" />
      <span className="sr-only">
        {machine.connection._tag === "Offline"
          ? "Not on this machine at the last scan"
          : "Not on this machine"}
      </span>
    </>
  );
}
