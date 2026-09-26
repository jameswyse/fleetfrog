import { actionBlocker } from "@fleetfrog/protocol/domain/actionAvailability";
import { suggestCloneDestination } from "@fleetfrog/protocol/domain/cloneDestination";
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

/** Where a clone of a repository onto a machine goes with one click, or why it can't. */
export type QuickClone =
  | { readonly _tag: "Ready"; readonly destination: string }
  | { readonly _tag: "Blocked"; readonly reason: string };

/**
 * A one-click clone uses the folder the clone dialog would suggest, and holds back wherever the
 * dialog would ask for a choice or a fix first.
 */
export function quickClone(options: {
  readonly fleet: Fleet;
  readonly repository: Repository;
  readonly machine: Machine;
}): QuickClone {
  const { fleet, repository, machine } = options;
  const blocker = cloneBlocker(machine);

  if (blocker !== null) {
    return { _tag: "Blocked", reason: blocker };
  }

  // The hub clones from an origin one of the other checkouts has.
  if (repository.checkouts.every(({ checkout }) => checkout.originUrl === null)) {
    return { _tag: "Blocked", reason: "No remote to clone it from" };
  }

  const suggestion = suggestCloneDestination({
    repository,
    target: machine,
    machines: fleet.machines,
    occupied: checkoutPaths(fleet.repositories, machine.id),
  });

  if (suggestion === null) {
    return { _tag: "Blocked", reason: "No free folder for it. Choose one in the clone dialog" };
  }

  if (suggestion.root.status === "Missing" || suggestion.root.status === "NotFolder") {
    return { _tag: "Blocked", reason: `Its project folder ${suggestion.root.path} doesn't exist` };
  }

  return { _tag: "Ready", destination: suggestion.destination };
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
