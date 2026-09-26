import { useState } from "react";

import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { suggestCloneDestination } from "@fleetfrog/protocol/domain/cloneDestination";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { checkoutPaths, cloneBlocker } from "./actionAvailability.ts";
import { draftFromSuggestion, draftPath, draftProblem } from "./cloneDestinationDraft.ts";
import { CloneDestinationField } from "./CloneDestinationField.tsx";
import { useStartBatch } from "./useStartBatch.ts";

import type { Fleet, Repository } from "@fleetfrog/protocol/domain/fleet";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";

import type { DestinationDraft } from "./cloneDestinationDraft.ts";

/** Chooses machines to clone a repository onto, each with a destination it can edit. */
export function CloneDialog({
  fleet,
  repository,
  onClose,
}: {
  readonly fleet: Fleet;
  readonly repository: Repository;
  readonly onClose: () => void;
}) {
  const { start, pending, failure } = useStartBatch();
  const holders = new Set(repository.checkouts.map(({ machineId }) => machineId));
  const candidates = fleet.machines
    .filter(({ id }) => !holders.has(id))
    .map((machine) => {
      const suggestion = suggestCloneDestination({
        repository,
        target: machine,
        machines: fleet.machines,
        occupied: checkoutPaths(fleet.repositories, machine.id),
      });
      const rootMissing =
        suggestion?.root.status === "Missing" || suggestion?.root.status === "NotFolder";

      return {
        machine,
        blocked: cloneBlocker(machine),
        draft: draftFromSuggestion({ machine, suggestion, repositoryName: repository.name }),
        // Said before anything is chosen, so a mistyped default folder is fixed first.
        warning:
          suggestion !== null && rootMissing
            ? `Its folder ${suggestion.root.path} doesn't exist. Choose another destination or fix the folder on the Machines page.`
            : null,
      };
    });
  const [chosen, setChosen] = useState<ReadonlySet<MachineId>>(() => new Set());
  const [drafts, setDrafts] = useState<ReadonlyMap<MachineId, DestinationDraft>>(
    () => new Map(candidates.map(({ machine, draft }) => [machine.id, draft])),
  );
  const [problems, setProblems] = useState<ReadonlyMap<MachineId, string>>(() => new Map());
  const [nothingChosen, setNothingChosen] = useState(false);
  const draftOf = (machineId: MachineId) =>
    drafts.get(machineId) ?? { root: "", name: repository.name };
  let submitLabel = chosen.size > 1 ? `Clone to ${chosen.size} machines` : "Clone";

  if (pending) {
    submitLabel = "Starting…";
  }

  const submit = (form: HTMLFormElement) => {
    const targets = candidates.filter(({ machine }) => chosen.has(machine.id));
    const found = new Map(
      targets.flatMap(({ machine }) => {
        const problem = draftProblem({
          draft: draftOf(machine.id),
          machine,
          repositories: fleet.repositories,
        });

        return problem === null ? [] : [[machine.id, problem] as const];
      }),
    );

    setProblems(found);
    setNothingChosen(targets.length === 0);

    const [first] = found.keys();

    if (first !== undefined) {
      const input = form.elements.namedItem(`destination-${first}`);

      if (input instanceof HTMLInputElement) {
        input.focus();
      }

      return;
    }

    const [head, ...rest] = targets.map(({ machine }) => ({
      machineId: machine.id,
      destination: draftPath(draftOf(machine.id)),
    }));

    if (head !== undefined) {
      start({ _tag: "Clone", repositoryKey: repository.key, targets: [head, ...rest] }, onClose);
    }
  };

  return (
    <Dialog title={`Clone ${repository.name}`} onClose={onClose}>
      {candidates.length === 0 ? (
        <div className="space-y-4 text-sm">
          <p>Every paired machine already has {repository.name}.</p>
          <div className="flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit(event.currentTarget);
          }}
          className="space-y-4 text-sm"
        >
          <p>
            Clones the default branch into a new folder. The folder must be inside one of the
            machine's project folders.
          </p>
          <fieldset className="space-y-3">
            <legend className="mb-2 font-medium">Machines without {repository.name}</legend>
            {candidates.map(({ machine, blocked, warning }) => {
              const checked = chosen.has(machine.id);
              const problem = problems.get(machine.id);
              const inputId = `destination-${machine.id}`;

              return (
                <div key={machine.id} className="rounded-md border border-line px-3 py-2.5">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={blocked !== null}
                      onChange={(event) => {
                        const next = new Set(chosen);

                        if (event.currentTarget.checked) {
                          next.add(machine.id);
                        } else {
                          next.delete(machine.id);
                        }

                        setChosen(next);
                      }}
                      className="size-4 accent-accent"
                    />
                    <span className="font-medium">{machineLabel(machine)}</span>
                    {blocked !== null && <span className="text-ink-muted">· {blocked}</span>}
                  </label>
                  {blocked === null && warning !== null && (
                    <p className="mt-1 ms-6 text-changes">{warning}</p>
                  )}
                  {checked && (
                    <div className="mt-2 ms-6">
                      <CloneDestinationField
                        id={inputId}
                        label="Destination"
                        machine={machine}
                        value={draftOf(machine.id)}
                        invalid={problem !== undefined}
                        describedBy={`${inputId}-error`}
                        onChange={(next) => setDrafts(new Map(drafts).set(machine.id, next))}
                      />
                      {problem !== undefined && (
                        <p id={`${inputId}-error`} className="mt-1 text-danger">
                          {problem}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </fieldset>
          <p role="status" className="text-danger">
            {nothingChosen ? "Choose at least one machine to clone onto." : failure}
          </p>
          <div className="flex justify-end gap-3">
            <Button onClick={onClose}>Cancel</Button>
            <Button tone="primary" type="submit" disabled={pending}>
              {submitLabel}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
