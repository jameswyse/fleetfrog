import { clonePath } from "@fleetfrog/protocol/domain/checkout";

import type { ActionRun, RunsSnapshot } from "@fleetfrog/protocol/domain/activity";
import type { Checkout } from "@fleetfrog/protocol/domain/checkout";
import type { Machine } from "@fleetfrog/protocol/domain/fleet";
import type { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

interface CheckoutTarget {
  readonly machineId: Machine["id"];
  readonly checkout: Checkout;
}

interface CloneTarget {
  readonly machineId: Machine["id"];
  readonly repositoryKey: RepositoryKey;
}

/**
 * Whether a run acts on a checkout. A fetch runs from a clone's main worktree but updates every
 * worktree of that clone, so it counts for all of them.
 */
function actsOn(run: ActionRun, target: CheckoutTarget): boolean {
  return (
    run.machineId === target.machineId &&
    (run.path === target.checkout.path ||
      (run.request._tag === "Fetch" && run.path === clonePath(target.checkout)))
  );
}

function clones(run: ActionRun, target: CloneTarget): boolean {
  return (
    run.request._tag === "Clone" &&
    run.machineId === target.machineId &&
    run.repositoryKey === target.repositoryKey
  );
}

function finishedAt(run: ActionRun): number {
  return run.state._tag === "Finished" ? run.state.finishedAt.epochMilliseconds : 0;
}

function newest(runs: ReadonlyArray<ActionRun>): ActionRun | undefined {
  return runs.toSorted((left, right) => finishedAt(right) - finishedAt(left))[0];
}

/** The queued or running run acting on a checkout. */
export function activeRunFor(runs: RunsSnapshot, target: CheckoutTarget): ActionRun | undefined {
  return runs.active.find((run) => actsOn(run, target));
}

/** The queued or running run on the first of these checkouts that has one, such as a cell's. */
export function activeRunOn(
  runs: RunsSnapshot,
  targets: ReadonlyArray<CheckoutTarget>,
): ActionRun | undefined {
  return targets.map((target) => activeRunFor(runs, target)).find((run) => run !== undefined);
}

/** The most recent finished run on this checkout, including a fetch run from its clone. */
export function latestRunFor(runs: RunsSnapshot, target: CheckoutTarget): ActionRun | undefined {
  return newest(runs.latest.filter((run) => actsOn(run, target)));
}

/** The clone of a repository that is queued or running on a machine. */
export function activeCloneFor(runs: RunsSnapshot, target: CloneTarget): ActionRun | undefined {
  return runs.active.find((run) => clones(run, target));
}

/** The most recent finished clone of a repository onto a machine. */
export function latestCloneFor(runs: RunsSnapshot, target: CloneTarget): ActionRun | undefined {
  return newest(runs.latest.filter((run) => clones(run, target)));
}
