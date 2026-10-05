import { useState } from "react";

import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { plural } from "@/ui/plural.ts";
import {
  checkFolderPath,
  cloneSource,
  expandHome,
  suggestCloneDestination,
} from "@fleetfrog/protocol/domain/cloneDestination";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { checkoutPaths, cloneBlocker } from "../actions/actionAvailability.ts";
import { draftFromSuggestion, draftPath, draftProblem } from "../actions/cloneDestinationDraft.ts";
import { CloneDestinationField } from "../actions/CloneDestinationField.tsx";
import { useStartBatch } from "../actions/useStartBatch.ts";

import type { Fleet, Machine, Repository } from "@fleetfrog/protocol/domain/fleet";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";
import type { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

import type { DestinationDraft } from "../actions/cloneDestinationDraft.ts";

type Candidate =
  | { readonly _tag: "Clonable"; readonly repository: Repository; readonly draft: DestinationDraft }
  | { readonly _tag: "Unclonable"; readonly repository: Repository };

function missingOn(
  repositories: ReadonlyArray<Repository>,
  machine: Machine,
): ReadonlyArray<Repository> {
  return repositories.filter(
    ({ checkouts }) => !checkouts.some(({ machineId }) => machineId === machine.id),
  );
}

function candidatesFor(
  fleet: Fleet,
  repositories: ReadonlyArray<Repository>,
  machine: Machine,
): ReadonlyArray<Candidate> {
  const occupied = new Set(checkoutPaths(fleet.repositories, machine.id));

  return missingOn(repositories, machine).map((repository): Candidate => {
    if (cloneSource(repository) === undefined) {
      return { _tag: "Unclonable", repository };
    }

    const suggestion = suggestCloneDestination({
      repository,
      target: machine,
      machines: fleet.machines,
      occupied,
    });

    const draft = draftFromSuggestion({ machine, suggestion, repositoryName: repository.name });

    occupied.add(expandHome(draftPath(draft), machine.info.homeDirectory));

    return { _tag: "Clonable", repository, draft };
  });
}

function problemsFor(options: {
  readonly fleet: Fleet;
  readonly machine: Machine;
  readonly chosen: ReadonlyArray<{ readonly key: RepositoryKey; readonly draft: DestinationDraft }>;
}): ReadonlyMap<RepositoryKey, string> {
  const claimed = new Set<string>();

  return new Map(
    options.chosen.flatMap(({ key, draft }) => {
      const folder = checkFolderPath({
        path: draftPath(draft),
        home: options.machine.info.homeDirectory,
      });

      const path = folder._tag === "Valid" ? folder.path : null;

      const problem =
        draftProblem({
          draft,
          machine: options.machine,
          repositories: options.fleet.repositories,
        }) ??
        (path !== null && claimed.has(path)
          ? "Another repository you chose uses this folder."
          : null);

      if (path !== null) {
        claimed.add(path);
      }

      return problem === null ? [] : [[key, problem] as const];
    }),
  );
}

function toggled<Key>(set: ReadonlySet<Key>, key: Key, on: boolean): ReadonlySet<Key> {
  const next = new Set(set);

  if (on) {
    next.add(key);
  } else {
    next.delete(key);
  }

  return next;
}

function MachineClones({
  fleet,
  groupName,
  machine,
  repositories,
  onClose,
}: {
  readonly fleet: Fleet;
  readonly groupName: string;
  readonly machine: Machine;
  readonly repositories: ReadonlyArray<Repository>;
  readonly onClose: () => void;
}) {
  const { start, pending, failure } = useStartBatch();
  const [edits, setEdits] = useState<ReadonlyMap<RepositoryKey, DestinationDraft>>(() => new Map());

  const rows = candidatesFor(fleet, repositories, machine).map((candidate): Candidate =>
    candidate._tag === "Clonable"
      ? { ...candidate, draft: edits.get(candidate.repository.key) ?? candidate.draft }
      : candidate,
  );

  const clonable = rows.flatMap((row) =>
    row._tag === "Clonable" ? [{ key: row.repository.key, draft: row.draft }] : [],
  );

  const [chosen, setChosen] = useState<ReadonlySet<RepositoryKey>>(() => {
    const problems = problemsFor({ fleet, machine, chosen: clonable });

    return new Set(clonable.flatMap(({ key }) => (problems.has(key) ? [] : [key])));
  });

  const [editing, setEditing] = useState<ReadonlySet<RepositoryKey>>(() => new Set());
  const selected = clonable.filter(({ key }) => chosen.has(key));

  const problems = problemsFor({ fleet, machine, chosen: selected });

  let submitLabel =
    selected.length === 0
      ? "Clone"
      : `Clone ${plural(selected.length, "repository", "repositories")}`;

  if (pending) {
    submitLabel = "Starting…";
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();

        const [first] = problems.keys();

        if (first !== undefined) {
          const input = event.currentTarget.elements.namedItem(`destination-${first}`);

          if (input instanceof HTMLInputElement) {
            input.focus();
          }

          return;
        }

        const [head, ...rest] = selected.map(({ key, draft }) => ({
          repositoryKey: key,
          machineId: machine.id,
          destination: draftPath(draft),
        }));

        if (head !== undefined) {
          start({ _tag: "CloneRepositories", groupName, clones: [head, ...rest] }, onClose);
        }
      }}
      className="space-y-4"
    >
      <fieldset className="min-w-0">
        <legend className="mb-2 font-medium">
          Repositories to clone to {machineLabel(machine)}
        </legend>
        <ul className="max-h-80 overflow-auto rounded-md border border-line">
          {rows.map((row) => {
            const { repository } = row;
            const { key } = repository;
            const checked = chosen.has(key);
            const problem = problems.get(key);
            const inputId = `destination-${key}`;
            const open = checked && (editing.has(key) || problem !== undefined);

            if (row._tag === "Unclonable") {
              return (
                <li
                  key={key}
                  className="flex items-start gap-3 border-b border-line px-3 py-2 last:border-b-0"
                >
                  <input
                    type="checkbox"
                    disabled
                    aria-label={repository.label}
                    className="mt-0.5 size-4 shrink-0 accent-accent"
                  />
                  <span className="grid min-w-0">
                    <span className="truncate font-medium text-ink-muted">{repository.label}</span>
                    <span className="text-xs text-changes">No remote to clone from</span>
                  </span>
                </li>
              );
            }

            const { draft } = row;

            return (
              <li key={key} className="border-b border-line px-3 py-2 last:border-b-0">
                <div className="flex items-start gap-3">
                  <input
                    id={`clone-${key}`}
                    type="checkbox"
                    checked={checked}
                    onChange={(event) =>
                      setChosen(toggled(chosen, key, event.currentTarget.checked))
                    }
                    className="mt-0.5 size-4 shrink-0 accent-accent"
                  />
                  <span className="grid min-w-0 flex-1">
                    <label htmlFor={`clone-${key}`} className="cursor-pointer truncate font-medium">
                      {repository.label}
                    </label>
                    {!open && (
                      <span className="truncate font-mono text-xs text-ink-muted">
                        {draftPath(draft)}
                      </span>
                    )}
                  </span>
                  {checked && !open && (
                    <button
                      type="button"
                      onClick={() => setEditing(toggled(editing, key, true))}
                      className="shrink-0 rounded px-1 text-xs font-medium text-accent-text hover:underline"
                    >
                      Change folder
                    </button>
                  )}
                </div>
                {open && (
                  <div className="mt-2 ms-7">
                    <CloneDestinationField
                      id={inputId}
                      label="Destination"
                      machine={machine}
                      value={draft}
                      invalid={problem !== undefined}
                      describedBy={`${inputId}-error`}
                      onChange={(next) => setEdits(new Map(edits).set(key, next))}
                    />
                    {problem !== undefined && (
                      <p id={`${inputId}-error`} className="mt-1 text-danger">
                        {problem}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>
      <p role="status" className="text-danger">
        {failure}
      </p>
      <div className="flex justify-end gap-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button tone="primary" type="submit" disabled={pending || selected.length === 0}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
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
  const machines = fleet.machines.map((machine) => ({
    machine,
    missing: missingOn(repositories, machine).length,
    blocked: cloneBlocker(machine),
  }));

  const [machineId, setMachineId] = useState<MachineId | null>(
    () =>
      machines.find(({ missing, blocked }) => missing > 0 && blocked === null)?.machine.id ?? null,
  );

  const machine = fleet.machines.find(({ id }) => id === machineId) ?? null;
  const everywhere = machines.every(({ missing }) => missing === 0);

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
        <div className="space-y-4 text-sm">
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
                    onChange={() => setMachineId(candidate.id)}
                    className="size-4 accent-accent"
                  />
                  <span className="font-medium">{machineLabel(candidate)}</span>
                  <span className="ms-auto text-ink-muted">{note}</span>
                </label>
              );
            })}
          </fieldset>
          {machine === null ? (
            <div className="flex justify-end">
              <Button onClick={onClose}>Cancel</Button>
            </div>
          ) : (
            <MachineClones
              key={machine.id}
              fleet={fleet}
              groupName={groupName}
              machine={machine}
              repositories={repositories}
              onClose={onClose}
            />
          )}
        </div>
      )}
    </Dialog>
  );
}
