import { useState } from "react";

import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { plural } from "@/ui/plural.ts";
import {
  cloneSource,
  expandHome,
  suggestCloneDestination,
} from "@fleetfrog/protocol/domain/cloneDestination";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import {
  checkoutPaths,
  cloneBlocker,
  cloneDestinationProblem,
} from "../actions/actionAvailability.ts";
import { useStartBatch } from "../actions/useStartBatch.ts";

import type { Fleet, Machine, Repository } from "@fleetfrog/protocol/domain/fleet";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";
import type { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

type PlannedClone =
  | { readonly _tag: "Ready"; readonly repository: Repository; readonly destination: string }
  | { readonly _tag: "Blocked"; readonly repository: Repository; readonly problem: string };

function missingOn(
  repositories: ReadonlyArray<Repository>,
  machine: Machine,
): ReadonlyArray<Repository> {
  return repositories.filter(
    ({ checkouts }) => !checkouts.some(({ machineId }) => machineId === machine.id),
  );
}

function planClones(
  fleet: Fleet,
  repositories: ReadonlyArray<Repository>,
  machine: Machine,
  skipped: ReadonlySet<RepositoryKey>,
): ReadonlyArray<PlannedClone> {
  const occupied = new Set(checkoutPaths(fleet.repositories, machine.id));
  const claimed = new Set<string>();

  return missingOn(repositories, machine).map((repository) => {
    if (cloneSource(repository) === undefined) {
      return { _tag: "Blocked", repository, problem: "No remote to clone from" };
    }

    const suggestion = suggestCloneDestination({
      repository,
      target: machine,
      machines: fleet.machines,
      occupied,
    });

    if (suggestion === null) {
      return { _tag: "Blocked", repository, problem: "No project folder to clone into" };
    }

    const path = expandHome(suggestion.destination, machine.info.homeDirectory);

    const problem =
      cloneDestinationProblem({
        destination: suggestion.destination,
        machine,
        repositories: fleet.repositories,
      }) ?? (claimed.has(path) ? "Another repository here would use the same folder" : null);

    if (problem !== null) {
      return { _tag: "Blocked", repository, problem };
    }

    if (!skipped.has(repository.key)) {
      claimed.add(path);
      occupied.add(path);
    }

    return { _tag: "Ready", repository, destination: suggestion.destination };
  });
}

export function GroupCloneDialog({
  fleet,
  groupName,
  repositories,
  onClose,
}: {
  readonly fleet: Fleet;
  readonly groupName: string;
  readonly repositories: ReadonlyArray<Repository>;
  readonly onClose: () => void;
}) {
  const { start, pending, failure } = useStartBatch();

  const machines = fleet.machines.map((machine) => ({
    machine,
    missing: missingOn(repositories, machine).length,
    blocked: cloneBlocker(machine),
  }));

  const [machineId, setMachineId] = useState<MachineId | null>(
    () =>
      machines.find(({ missing, blocked }) => missing > 0 && blocked === null)?.machine.id ?? null,
  );

  const [skipped, setSkipped] = useState<ReadonlySet<RepositoryKey>>(() => new Set());
  const machine = fleet.machines.find(({ id }) => id === machineId) ?? null;
  const planned = machine === null ? [] : planClones(fleet, repositories, machine, skipped);

  const chosen = planned.flatMap((clone) =>
    clone._tag === "Ready" && !skipped.has(clone.repository.key)
      ? [{ repositoryKey: clone.repository.key, destination: clone.destination }]
      : [],
  );

  const everywhere = machines.every(({ missing }) => missing === 0);

  let submitLabel =
    chosen.length === 0 ? "Clone" : `Clone ${plural(chosen.length, "repository", "repositories")}`;

  if (pending) {
    submitLabel = "Starting…";
  }

  return (
    <Dialog title={`Clone ${groupName} to a machine`} onClose={onClose}>
      {everywhere ? (
        <div className="space-y-4 text-sm">
          <p>Every paired machine already has these repositories.</p>
          <div className="flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();

            if (machine === null) {
              return;
            }

            const [head, ...rest] = chosen.map((clone) => ({ ...clone, machineId: machine.id }));

            if (head !== undefined) {
              start({ _tag: "CloneRepositories", groupName, clones: [head, ...rest] }, onClose);
            }
          }}
          className="space-y-4 text-sm"
        >
          <p>
            Clones each repository the machine doesn't have yet into its project folders, using the
            same folder as on your other machines where it can.
          </p>
          <fieldset className="min-w-0 space-y-1.5">
            <legend className="mb-2 font-medium">Machine</legend>
            {machines.map(({ machine: candidate, missing, blocked }) => {
              let note = `${missing} missing`;

              if (blocked !== null) {
                note = blocked;
              } else if (missing === 0) {
                note = "Has all of them";
              }

              return (
                <label
                  key={candidate.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md border border-line px-3 py-2 has-checked:border-accent has-checked:bg-accent-soft has-disabled:cursor-not-allowed has-disabled:opacity-60"
                >
                  <input
                    type="radio"
                    name="machine"
                    checked={machineId === candidate.id}
                    disabled={blocked !== null || missing === 0}
                    onChange={() => {
                      setMachineId(candidate.id);
                      setSkipped(new Set());
                    }}
                    className="size-4 accent-accent"
                  />
                  <span className="font-medium">{machineLabel(candidate)}</span>
                  <span className="ms-auto text-ink-muted">{note}</span>
                </label>
              );
            })}
          </fieldset>
          {machine !== null && (
            <fieldset className="min-w-0">
              <legend className="mb-2 font-medium">
                Repositories to clone to {machineLabel(machine)}
              </legend>
              <ul className="max-h-64 overflow-auto rounded-md border border-line">
                {planned.map((clone) => {
                  const { repository } = clone;
                  const available = clone._tag === "Ready";

                  return (
                    <li key={repository.key} className="border-b border-line last:border-b-0">
                      <label
                        className={`flex items-start gap-3 px-3 py-2 ${available ? "cursor-pointer hover:bg-surface-raised" : "cursor-not-allowed"}`}
                      >
                        <input
                          type="checkbox"
                          checked={available && !skipped.has(repository.key)}
                          disabled={!available}
                          onChange={(event) => {
                            const next = new Set(skipped);

                            if (event.currentTarget.checked) {
                              next.delete(repository.key);
                            } else {
                              next.add(repository.key);
                            }

                            setSkipped(next);
                          }}
                          className="mt-0.5 size-4 shrink-0 accent-accent"
                        />
                        <span className="grid min-w-0">
                          <span
                            className={`truncate font-medium ${available ? "" : "text-ink-muted"}`}
                          >
                            {repository.label}
                          </span>
                          {clone._tag === "Ready" ? (
                            <span className="truncate font-mono text-xs text-ink-muted">
                              {clone.destination}
                            </span>
                          ) : (
                            <span className="text-xs text-changes">{clone.problem}</span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}
          <p role="status" className="text-danger">
            {failure}
          </p>
          <div className="flex justify-end gap-3">
            <Button onClick={onClose}>Cancel</Button>
            <Button tone="primary" type="submit" disabled={pending || chosen.length === 0}>
              {submitLabel}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
