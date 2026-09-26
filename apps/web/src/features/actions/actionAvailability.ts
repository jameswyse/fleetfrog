import { actionBlocker } from "@fleetfrog/protocol/domain/actionAvailability";
import { pullBlocker } from "@fleetfrog/protocol/domain/pullEligibility";

import { describeOutcome, describeSkip } from "./actionCopy.ts";

import type { ActionKind } from "@fleetfrog/protocol/domain/action";
import type { ActionScope } from "@fleetfrog/protocol/domain/activity";
import type { Checkout } from "@fleetfrog/protocol/domain/checkout";
import type { Fleet, Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

/** Why the machine can't run an action now, or null when it can. The agent has the final say. */
export function machineBlocker(machine: Machine, kind: ActionKind): string | null {
  const blocker = actionBlocker(machine, kind);

  if (blocker === null) {
    return null;
  }

  const { summary, detail } = describeOutcome(blocker);

  return detail ?? summary;
}

/** Why a machine can't take a clone, or null when it can. */
export function cloneBlocker(machine: Machine): string | null {
  return (
    machineBlocker(machine, "Clone") ??
    (machine.discoveryRoots.length === 0 ? "No project folders set" : null)
  );
}

/** The paths of every checkout on one machine. */
export function checkoutPaths(
  repositories: ReadonlyArray<Repository>,
  machineId: Machine["id"],
): ReadonlySet<string> {
  return new Set(
    repositories.flatMap(({ checkouts }) =>
      checkouts
        .filter((entry) => entry.machineId === machineId)
        .map(({ checkout }) => checkout.path),
    ),
  );
}

/** Why a pull would skip this checkout as last scanned, or null when it would go ahead. */
export function pullSkipReason(machine: Machine, checkout: Checkout): string | null {
  const blocked = machineBlocker(machine, "Pull");

  if (blocked !== null) {
    return blocked;
  }

  // An unreadable checkout is read again by the agent, which then decides.
  if (checkout.status._tag === "Failed") {
    return null;
  }

  const reason = pullBlocker(checkout.status.git);

  return reason === null ? null : describeSkip(reason);
}

/** The scopes a pull asks to confirm, because they can cover more than one checkout. */
export type PullScope = Exclude<ActionScope, { _tag: "Checkout" }>;

/** Every checkout a pull would cover, with why it would be skipped as of the last scan. */
export function pullTargets(fleet: Fleet, scope: PullScope) {
  const machines = new Map(fleet.machines.map((machine) => [machine.id, machine]));

  return fleet.repositories
    .filter((repository) => scope._tag !== "Repository" || repository.key === scope.repositoryKey)
    .flatMap((repository) =>
      repository.checkouts
        .filter(({ machineId }) => scope._tag !== "Machine" || machineId === scope.machineId)
        .flatMap(({ machineId, checkout }) => {
          const machine = machines.get(machineId);

          return machine === undefined
            ? []
            : [{ repository, machine, checkout, skip: pullSkipReason(machine, checkout) }];
        }),
    );
}

/** Whether a pull over this scope would change at least one checkout, as of the last scan. */
export function canPull(fleet: Fleet, scope: PullScope): boolean {
  return pullTargets(fleet, scope).some(({ skip }) => skip === null);
}
