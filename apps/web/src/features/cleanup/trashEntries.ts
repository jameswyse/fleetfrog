import type { DateTime } from "effect";

import type { TrashTarget } from "@fleetfrog/protocol/domain/action";
import type { DeletedBranch } from "@fleetfrog/protocol/domain/checkout";
import type { Fleet, Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

/** One thing in a machine's trash, with what the dashboard shows about it. */
export interface TrashEntry {
  readonly key: string;
  readonly machine: Machine;
  readonly repository: Repository;
  readonly target: TrashTarget;
  readonly deletedAt: DateTime.Utc;
  readonly item: { readonly _tag: "Branch"; readonly branch: DeletedBranch };
}

/** Everything in every machine's trash, most recently deleted first. */
export function trashEntries(fleet: Fleet): ReadonlyArray<TrashEntry> {
  const machines = new Map(fleet.machines.map((machine) => [machine.id, machine]));

  return fleet.repositories
    .flatMap((repository) =>
      repository.checkouts.flatMap(({ machineId, checkout }) => {
        const machine = machines.get(machineId);

        if (machine === undefined || checkout.status._tag !== "Read") {
          return [];
        }

        return checkout.status.git.deletedBranches.items.map((branch): TrashEntry => ({
          key: `${machineId}:${checkout.path}:${branch.ref}`,
          machine,
          repository,
          target: { _tag: "Branch", path: checkout.path, ref: branch.ref },
          deletedAt: branch.deletedAt,
          item: { _tag: "Branch", branch },
        }));
      }),
    )
    .toSorted(
      (left, right) => right.deletedAt.epochMilliseconds - left.deletedAt.epochMilliseconds,
    );
}
