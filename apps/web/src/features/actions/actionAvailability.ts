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

export function machineBlocker(machine: Machine, kind: ActionKind): string | null {
  const blocker = actionBlocker(machine, kind);

  if (blocker === null) {
    return null;
  }

  const { summary, detail } = describeOutcome(blocker);

  return detail ?? summary;
}

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

  if (checkout.status._tag === "Failed") {
    return null;
  }

  const reason = blocker(checkout.status.git);

  return reason === null ? null : describeSkip(reason);
}

export function pullSkipReason(machine: Machine, checkout: Checkout): string | null {
  return checkoutSkipReason(machine, checkout, "Pull", pullBlocker);
}

export function stashSkipReason(machine: Machine, checkout: Checkout): string | null {
  return checkoutSkipReason(machine, checkout, "Stash", stashBlocker);
}

export function switchSkipReason(
  machine: Machine,
  checkout: Checkout,
  branch: string,
): string | null {
  return checkoutSkipReason(machine, checkout, "Switch", (git) => switchBlocker(git, branch));
}

export type PullScope = Exclude<ActionScope, { _tag: "Checkout" }>;

function inScope(repository: Repository, scope: PullScope): boolean {
  if (scope._tag === "Repository") {
    return repository.key === scope.repositoryKey;
  }

  return scope._tag !== "Repositories" || scope.repositoryKeys.includes(repository.key);
}

export function pullTargets(fleet: Fleet, scope: PullScope) {
  const machines = new Map(fleet.machines.map((machine) => [machine.id, machine]));

  return fleet.repositories
    .filter((repository) => inScope(repository, scope))
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

export function canFetch(fleet: Fleet, repositories: ReadonlyArray<Repository>): boolean {
  const machines = new Map(fleet.machines.map((machine) => [machine.id, machine]));

  return repositories.some(({ checkouts }) =>
    checkouts.some(({ machineId }) => {
      const machine = machines.get(machineId);

      return machine !== undefined && machineBlocker(machine, "Fetch") === null;
    }),
  );
}

export function canPull(fleet: Fleet, scope: PullScope): boolean {
  return pullTargets(fleet, scope).some(({ skip }) => skip === null);
}
