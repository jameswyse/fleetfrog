import { CircleDashedIcon, DownloadIcon } from "lucide-react";

import { Spinner } from "@/ui/Spinner.tsx";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { quickClone } from "../actions/actionAvailability.ts";
import { describeOutcome } from "../actions/actionCopy.ts";
import { RunActivity } from "../actions/RunActivity.tsx";
import { activeCloneFor, latestCloneFor } from "../actions/runLookup.ts";
import { useStartBatch } from "../actions/useStartBatch.ts";

import type { RunsSnapshot } from "@fleetfrog/protocol/domain/activity";
import type { Fleet, Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

/** Marks a repository missing from a machine, faint enough to leave the grid's states standing out. */
function MissingMark() {
  return <CircleDashedIcon aria-hidden="true" className="text-ink-muted/40" />;
}

/**
 * A repository's cell on a machine that doesn't have it. Where one click can clone it, hovering or
 * focusing the cell offers that clone, which starts at once into the folder the clone dialog would
 * suggest and then shows its progress here.
 */
export function MissingCell({
  fleet,
  repository,
  machine,
  runs,
  className,
}: {
  readonly fleet: Fleet;
  readonly repository: Repository;
  readonly machine: Machine;
  readonly runs: RunsSnapshot;
  /** The cell's size and focus ring, shared with the rest of the grid. */
  readonly className: string;
}) {
  const { start, pending, failure } = useStartBatch();
  const target = { machineId: machine.id, repositoryKey: repository.key };
  const cloning = activeCloneFor(runs, target);
  // Starts where the column's branch names start, so the column keeps one edge.
  const layout = `flex h-full items-center px-3 py-2 text-start text-sm ${className}`;
  const missing =
    machine.connection._tag === "Offline"
      ? "Not on this machine at the last scan"
      : "Not on this machine";

  if (machine.lastDiscoveryAt === null) {
    return <div className={`${layout} text-ink-muted italic`}>Not scanned</div>;
  }

  if (cloning !== undefined) {
    return (
      <div className={layout}>
        <span className="w-full min-w-0 text-xs">
          <RunActivity run={cloning} layout="Stacked" />
        </span>
      </div>
    );
  }

  const quick = quickClone({ fleet, repository, machine });

  if (quick._tag === "Blocked") {
    return (
      <div className={layout} title={`${missing}. It can't be cloned here: ${quick.reason}.`}>
        <MissingMark />
        <span className="sr-only">{missing}</span>
      </div>
    );
  }

  const last = latestCloneFor(runs, target);
  const lastFailure =
    last?.state._tag === "Finished" && last.state.outcome._tag !== "Succeeded"
      ? describeOutcome(last.state.outcome)
      : null;
  // A refusal to start outranks an older failed run.
  const problem = failure ?? lastFailure?.detail ?? lastFailure?.summary ?? null;

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start({
          _tag: "Clone",
          repositoryKey: repository.key,
          targets: [{ machineId: machine.id, destination: quick.destination }],
        })
      }
      // Named in full here, since the visible prompt shows only on hover or focus.
      aria-label={
        problem === null
          ? `Clone ${repository.name} onto ${machineLabel(machine)}`
          : `Clone again, ${repository.name} onto ${machineLabel(machine)}. The last clone failed: ${problem}`
      }
      title={
        problem === null
          ? `Clone into ${quick.destination}`
          : `The last clone failed: ${problem}\nClone into ${quick.destination}`
      }
      className={`group ${layout} hover:bg-surface-raised`}
    >
      {pending ? (
        <span className="flex items-center gap-1.5 text-xs text-sync">
          <Spinner />
          Starting…
        </span>
      ) : (
        <>
          <span className="group-hover:hidden group-focus-visible:hidden">
            {problem === null ? (
              <MissingMark />
            ) : (
              <span className="text-xs font-medium text-danger">Clone failed</span>
            )}
          </span>
          <span className="-ms-2 hidden items-center gap-1.5 rounded-md bg-accent-soft px-2 py-1 text-xs font-medium text-accent-text group-hover:flex group-focus-visible:flex">
            <DownloadIcon className="size-3.5" />
            {problem === null ? "Clone" : "Clone again"}
          </span>
        </>
      )}
    </button>
  );
}
