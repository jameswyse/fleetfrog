import { repositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

import type { DateTime } from "effect";

import type { TrashTarget } from "@fleetfrog/protocol/domain/action";
import type { DeletedBranch, DroppedStash } from "@fleetfrog/protocol/domain/checkout";
import type { Fleet, Machine } from "@fleetfrog/protocol/domain/fleet";
import type { TrashedCheckout } from "@fleetfrog/protocol/domain/trash";

/** One thing in a machine's trash, with what the dashboard shows about it. */
export interface TrashEntry {
  readonly key: string;
  readonly machine: Machine;
  /** The repository's label, or the checkout's folder name when no machine has it any more. */
  readonly repositoryLabel: string;
  readonly target: TrashTarget;
  readonly deletedAt: DateTime.Utc;
  readonly item:
    | { readonly _tag: "Branch"; readonly branch: DeletedBranch }
    | { readonly _tag: "Stash"; readonly stash: DroppedStash }
    | { readonly _tag: "Checkout"; readonly checkout: TrashedCheckout };
}

/** Everything in every machine's trash, most recently deleted first. */
export function trashEntries(fleet: Fleet): ReadonlyArray<TrashEntry> {
  const machines = new Map(fleet.machines.map((machine) => [machine.id, machine]));
  // Archived checkouts keep their deleted branches too.
  const repositories = [...fleet.repositories, ...fleet.archive];
  const labels = new Map(repositories.map(({ key, label }) => [key, label]));

  const refs = repositories.flatMap((repository) =>
    repository.checkouts.flatMap(({ machineId, checkout }) => {
      const machine = machines.get(machineId);

      if (machine === undefined || checkout.status._tag !== "Read") {
        return [];
      }

      const { git } = checkout.status;

      const branches = git.deletedBranches.items.map((branch): TrashEntry => ({
        key: `${machineId}:${checkout.path}:${branch.ref}`,
        machine,
        repositoryLabel: repository.label,
        target: { _tag: "Branch", path: checkout.path, ref: branch.ref },
        deletedAt: branch.deletedAt,
        item: { _tag: "Branch", branch },
      }));

      const stashes = git.droppedStashes.items.map((stash): TrashEntry => ({
        key: `${machineId}:${checkout.path}:${stash.ref}`,
        machine,
        repositoryLabel: repository.label,
        target: { _tag: "Stash", path: checkout.path, ref: stash.ref },
        deletedAt: stash.droppedAt,
        item: { _tag: "Stash", stash },
      }));

      return [...branches, ...stashes];
    }),
  );

  const checkouts = fleet.machines.flatMap((machine) =>
    machine.trash.map((checkout): TrashEntry => ({
      key: `${machine.id}:${checkout.id}`,
      machine,
      repositoryLabel: labels.get(repositoryKey(checkout.identity)) ?? checkout.directoryName,
      target: { _tag: "Checkout", id: checkout.id },
      deletedAt: checkout.trashedAt,
      item: { _tag: "Checkout", checkout },
    })),
  );

  return [...refs, ...checkouts].toSorted(
    (left, right) => right.deletedAt.epochMilliseconds - left.deletedAt.epochMilliseconds,
  );
}

/** Whether two trash targets name the same thing. */
export function sameTarget(left: TrashTarget, right: TrashTarget): boolean {
  if (left._tag === "Checkout") {
    return right._tag === "Checkout" && right.id === left.id;
  }

  return right._tag === left._tag && right.path === left.path && right.ref === left.ref;
}
