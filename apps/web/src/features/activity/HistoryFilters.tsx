import { useState } from "react";

import { useNavigate, useSearch } from "@tanstack/react-router";

import { knownFleet, useHub } from "@/rpc/hubConnection.ts";
import { MachineKindIcon } from "@/ui/MachineKindIcon.tsx";
import { machineKind, machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { outcomeKinds, outcomeLabels } from "../actions/actionCopy.ts";
import { StatusDot } from "./RunCountChips.tsx";

import type { ReactNode } from "react";

import type { OutcomeKind } from "@fleetfrog/protocol/domain/action";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";
import type { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

interface Choice<Value extends string> {
  readonly value: Value;
  readonly label: string;
  /** Shown before the label, such as a machine's icon. */
  readonly icon?: ReactNode;
  /** Shown after the label, such as an outcome's colour. */
  readonly marker?: ReactNode;
}

/** One filter as a list of checkboxes, any number of which can be ticked. */
function ChoiceGroup<Value extends string>({
  legend,
  choices,
  selected,
  onChange,
  empty,
  children,
}: {
  readonly legend: string;
  readonly choices: ReadonlyArray<Choice<Value>>;
  readonly selected: ReadonlyArray<Value>;
  readonly onChange: (values: ReadonlyArray<Value>) => void;
  /** Shown when there are no choices. */
  readonly empty: string;
  /** Anything between the legend and the list, such as a field to narrow it. */
  readonly children?: ReactNode;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 flex w-full items-baseline justify-between gap-2 px-2.5 text-xs font-medium text-ink-muted">
        {legend}
        {selected.length > 0 && <span className="font-normal">{selected.length} selected</span>}
      </legend>
      {children}
      <ul className="max-h-80 space-y-px overflow-y-auto">
        {choices.length === 0 && <li className="px-2.5 py-1.5 text-sm text-ink-muted">{empty}</li>}
        {choices.map((choice) => (
          <li key={choice.value}>
            <label className="flex min-h-8 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink-muted hover:bg-surface-raised hover:text-ink has-checked:text-ink">
              <input
                type="checkbox"
                checked={selected.includes(choice.value)}
                onChange={(event) =>
                  onChange(
                    event.currentTarget.checked
                      ? [...selected, choice.value]
                      : selected.filter((value) => value !== choice.value),
                  )
                }
                className="size-4 shrink-0 accent-accent"
              />
              {choice.icon}
              <span className="min-w-0 flex-1 truncate" title={choice.label}>
                {choice.label}
              </span>
              {choice.marker}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/**
 * The history filters. Each list matches any of its ticked values, and an action must match every
 * list that has one.
 */
export function HistoryFilters() {
  const hub = useHub();
  const fleet = knownFleet(hub);
  const search = useSearch({ from: "/_app/activity" });
  const navigate = useNavigate({ from: "/activity" });
  const [query, setQuery] = useState("");
  // On narrow screens the sidebar sits above the history, so the lists start hidden there.
  const [shown, setShown] = useState(false);
  const machines = search.machines ?? [];
  const repositories = search.repositories ?? [];
  const outcomes = search.outcomes ?? [];
  const needle = query.trim().toLocaleLowerCase();

  // Each filter is its own search key, set or removed without touching the others.
  const setMachines = (next: ReadonlyArray<MachineId>) =>
    navigate({
      to: "/activity",
      search: ({ machines: _machines, ...rest }) =>
        next.length === 0 ? rest : { ...rest, machines: [...next] },
      replace: true,
    });

  const setRepositories = (next: ReadonlyArray<RepositoryKey>) =>
    navigate({
      to: "/activity",
      search: ({ repositories: _repositories, ...rest }) =>
        next.length === 0 ? rest : { ...rest, repositories: [...next] },
      replace: true,
    });

  const setOutcomes = (next: ReadonlyArray<OutcomeKind>) =>
    navigate({
      to: "/activity",
      search: ({ outcomes: _outcomes, ...rest }) =>
        next.length === 0 ? rest : { ...rest, outcomes: [...next] },
      replace: true,
    });

  const repositoryChoices = (fleet?.repositories ?? [])
    // Ticked repositories stay listed while narrowing, so every applied filter stays visible.
    .filter(
      ({ key, name }) => repositories.includes(key) || name.toLocaleLowerCase().includes(needle),
    )
    .map(({ key, name }) => ({ value: key, label: name }))
    .toSorted((left, right) => left.label.localeCompare(right.label));

  return (
    <section aria-labelledby="history-filters" className="border-t border-line px-3 py-4">
      <div className="flex min-h-8 items-center gap-2 ps-2.5 md:mb-3">
        <h2 id="history-filters" className="me-auto text-sm font-medium">
          Filters
        </h2>
        {machines.length + repositories.length + outcomes.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              void navigate({
                to: "/activity",
                search: ({ batch }) => (batch === undefined ? {} : { batch }),
                replace: true,
              });
            }}
            className="rounded-md px-2 py-1 text-sm text-ink-muted hover:bg-surface-raised hover:text-ink"
          >
            Clear all
          </button>
        )}
        <button
          type="button"
          aria-expanded={shown}
          aria-controls="history-filter-lists"
          onClick={() => setShown(!shown)}
          className="rounded-md px-2 py-1 text-sm text-ink-muted hover:bg-surface-raised hover:text-ink md:hidden"
        >
          {shown ? "Hide" : "Show"}
        </button>
      </div>
      <div
        id="history-filter-lists"
        className={`mt-3 space-y-5 md:mt-0 md:block ${shown ? "" : "hidden"}`}
      >
        <ChoiceGroup
          legend="Outcome"
          choices={outcomeKinds.map((outcome) => ({
            value: outcome,
            label: outcomeLabels[outcome],
            marker: <StatusDot status={outcome} />,
          }))}
          selected={outcomes}
          onChange={(next) => void setOutcomes(next)}
          empty="No outcomes"
        />
        <ChoiceGroup
          legend="Machine"
          choices={(fleet?.machines ?? []).map((machine) => ({
            value: machine.id,
            label: machineLabel(machine),
            icon: <MachineKindIcon kind={machineKind(machine)} className="text-ink-muted" />,
          }))}
          selected={machines}
          onChange={(next) => void setMachines(next)}
          empty="No machines are paired"
        />
        <ChoiceGroup
          legend="Repository"
          choices={repositoryChoices}
          selected={repositories}
          onChange={(next) => void setRepositories(next)}
          empty={needle === "" ? "No repositories yet" : "No repositories match"}
        >
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Find a repository"
            aria-label="Find a repository"
            autoComplete="off"
            spellCheck={false}
            className="mb-1 min-h-8 w-full rounded-md border border-line bg-canvas px-2.5 text-sm"
          />
        </ChoiceGroup>
      </div>
    </section>
  );
}
