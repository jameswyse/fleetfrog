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

export function activeRunFor(runs: RunsSnapshot, target: CheckoutTarget): ActionRun | undefined {
  return runs.active.find((run) => actsOn(run, target));
}

export function activeRunOn(
  runs: RunsSnapshot,
  targets: ReadonlyArray<CheckoutTarget>,
): ActionRun | undefined {
  return targets.map((target) => activeRunFor(runs, target)).find((run) => run !== undefined);
}

export function latestRunFor(runs: RunsSnapshot, target: CheckoutTarget): ActionRun | undefined {
  return newest(runs.latest.filter((run) => actsOn(run, target)));
}

export function activeCloneFor(runs: RunsSnapshot, target: CloneTarget): ActionRun | undefined {
  return runs.active.find((run) => clones(run, target));
}

export function latestCloneFor(runs: RunsSnapshot, target: CloneTarget): ActionRun | undefined {
  return newest(runs.latest.filter((run) => clones(run, target)));
}
