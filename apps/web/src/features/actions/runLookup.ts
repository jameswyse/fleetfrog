import { clonePath } from "@fleetfrog/protocol/domain/checkout";

import type { ActionRun, RunsSnapshot } from "@fleetfrog/protocol/domain/activity";
import type { Checkout } from "@fleetfrog/protocol/domain/checkout";
import type { Machine } from "@fleetfrog/protocol/domain/fleet";
import type { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

/**
 * The queued or running run acting on a checkout. A fetch runs from a clone's main worktree but
 * updates every worktree of that clone, so it counts for all of them.
 */
export function activeRunFor(
  runs: RunsSnapshot,
  target: { readonly machineId: Machine["id"]; readonly checkout: Checkout },
): ActionRun | undefined {
  return runs.active.find(
    (run) =>
      run.machineId === target.machineId &&
      (run.path === target.checkout.path ||
        (run.request._tag === "Fetch" && run.path === clonePath(target.checkout))),
  );
}

/** The clone of a repository that is queued or running on a machine. */
export function activeCloneFor(
  runs: RunsSnapshot,
  target: { readonly machineId: Machine["id"]; readonly repositoryKey: RepositoryKey },
): ActionRun | undefined {
  return runs.active.find(
    (run) =>
      run.request._tag === "Clone" &&
      run.machineId === target.machineId &&
      run.repositoryKey === target.repositoryKey,
  );
}

/** The most recent finished run on this checkout, including a fetch run from its clone. */
export function latestRunFor(
  runs: RunsSnapshot,
  target: { readonly machineId: Machine["id"]; readonly checkout: Checkout },
): ActionRun | undefined {
  const finishedAt = (run: ActionRun) =>
    run.state._tag === "Finished" ? run.state.finishedAt.epochMilliseconds : 0;

  return runs.latest
    .filter(
      (run) =>
        run.machineId === target.machineId &&
        (run.path === target.checkout.path ||
          (run.request._tag === "Fetch" && run.path === clonePath(target.checkout))),
    )
    .toSorted((left, right) => finishedAt(right) - finishedAt(left))[0];
}
