import { actionBlocker } from "@fleetfrog/protocol/domain/actionAvailability";
import { checkCloneDestination } from "@fleetfrog/protocol/domain/cloneDestination";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";
import { pullBlocker } from "@fleetfrog/protocol/domain/pullEligibility";
import { stashBlocker } from "@fleetfrog/protocol/domain/stashEligibility";
import { switchBlocker } from "@fleetfrog/protocol/domain/switchEligibility";

import { describeOutcome, describeSkip } from "./actionCopy.ts";

import type { ActionKind, SkipReason } from "@fleetfrog/protocol/domain/action";
import type { ActionScope } from "@fleetfrog/protocol/domain/activity";
import type { Checkout, GitStatus } from "@fleetfrog/protocol/domain/checkout";
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

const destinationHints = {
  NotAbsolute: "Enter a full path, or one starting with ~.",
  Hidden: "Choose a folder that isn't hidden and has no . or .. in its path.",
  OutsideRoots: "Choose a folder inside one of this machine's project folders.",
  InArchive: "Choose a folder outside the Archive folder.",
} as const;

/** Why a clone destination won't work on this machine, or null when it looks fine. */
export function cloneDestinationProblem(options: {
  readonly destination: string;
  readonly machine: Machine;
  readonly repositories: ReadonlyArray<Repository>;
}): string | null {
  const { machine } = options;

  const check = checkCloneDestination({
    destination: options.destination,
    home: machine.info.homeDirectory,
    roots: machine.discoveryRoots.map(({ path }) => path),
    archive: machine.archiveFolder,
  });

  if (check._tag !== "Valid") {
    return destinationHints[check._tag];
  }

  const root = machine.discoveryRoots.find(({ path }) => path === check.root);

  if (root?.status === "Missing" || root?.status === "NotFolder") {
    return `${check.root} doesn't exist on ${machineLabel(machine)}. Fix it on the Machines page.`;
  }

  return checkoutPaths(options.repositories, machine.id).has(check.path)
    ? "Another repository is already there. Choose a different folder."
    : null;
}

/**
 * Why an action on this checkout would be skipped as last scanned, or null when it would go ahead:
 * the machine can't take it, or the checkout's state rules it out.
 */
function checkoutSkipReason(
  machine: Machine,
  checkout: Checkout,
  kind: ActionKind,
  blocker: (git: GitStatus) => SkipReason | null,
): string | null {
  const blocked = machineBlocker(machine, kind);

  if (blocked !== null) {
    return blocked;
  }

  // An unreadable checkout is read again by the agent, which then decides.
  if (checkout.status._tag === "Failed") {
    return null;
  }

  const reason = blocker(checkout.status.git);

  return reason === null ? null : describeSkip(reason);
}

/** Why a pull would skip this checkout as last scanned, or null when it would go ahead. */
export function pullSkipReason(machine: Machine, checkout: Checkout): string | null {
  return checkoutSkipReason(machine, checkout, "Pull", pullBlocker);
}

/** Why stashing would skip this checkout as last scanned, or null when it would go ahead. */
export function stashSkipReason(machine: Machine, checkout: Checkout): string | null {
  return checkoutSkipReason(machine, checkout, "Stash", stashBlocker);
}

/** Why switching this checkout to `branch` would be skipped as last scanned, or null. */
export function switchSkipReason(
  machine: Machine,
  checkout: Checkout,
  branch: string,
): string | null {
  return checkoutSkipReason(machine, checkout, "Switch", (git) => switchBlocker(git, branch));
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
