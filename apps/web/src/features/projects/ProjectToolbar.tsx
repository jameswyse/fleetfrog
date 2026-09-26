import { useEffect, useRef } from "react";

import { useNavigate } from "@tanstack/react-router";
import { SearchIcon, XIcon } from "lucide-react";

import { repositoryMatches } from "./checkoutSummary.ts";
import { FleetActions } from "./FleetActions.tsx";

import type { HubState } from "@/rpc/hubConnection.ts";
import type { Repository } from "@fleetfrog/protocol/domain/fleet";

import type { RepositoryFilter } from "./checkoutSummary.ts";

/** Each filter shows a symbol from the grid's cells, with its name in a tooltip. */
const filters: ReadonlyArray<{
  readonly value: RepositoryFilter;
  readonly label: string;
  readonly symbol: { readonly text: string; readonly className: string } | null;
}> = [
  { value: "all", label: "All", symbol: null },
  { value: "changes", label: "Has changes", symbol: { text: "●", className: "text-changes" } },
  { value: "out-of-sync", label: "Out of sync", symbol: { text: "↑↓", className: "text-sync" } },
];

/** Whether a key press belongs to something the person is typing in. */
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest("input, textarea, select, dialog") !== null)
  );
}

/** Filters repositories by name. Pressing "/" anywhere else on the page moves here. */
function SearchField({ query }: { readonly query: string }) {
  const navigate = useNavigate({ from: "/" });
  const input = useRef<HTMLInputElement>(null);

  const search = (q: string) => {
    void navigate({
      search: ({ q: _previous, ...rest }) => (q === "" ? rest : { ...rest, q }),
      replace: true,
    });
  };

  useEffect(() => {
    const focusOnSlash = (event: KeyboardEvent) => {
      if (
        event.key !== "/" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isTyping(event.target)
      ) {
        return;
      }

      event.preventDefault();
      input.current?.focus();
      input.current?.select();
    };

    document.addEventListener("keydown", focusOnSlash);

    return () => document.removeEventListener("keydown", focusOnSlash);
  }, []);

  return (
    <div className="relative">
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-muted"
      />
      <input
        ref={input}
        type="search"
        aria-label="Search repositories"
        aria-keyshortcuts="/"
        placeholder="Search"
        // Uncontrolled: the router commits search updates in a transition, so a controlled value
        // would lag behind typing and move the caret.
        defaultValue={query}
        onChange={(event) => search(event.currentTarget.value)}
        // The browser's own clear button shows only on hover, so the field draws its own.
        className="peer min-h-9 w-56 rounded-md border border-line bg-surface ps-8 pe-9 [&::-webkit-search-cancel-button]:appearance-none"
      />
      <button
        type="button"
        aria-label="Clear the search"
        onClick={() => {
          if (input.current !== null) {
            input.current.value = "";
            input.current.focus();
          }

          search("");
        }}
        className="absolute end-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-ink-muted peer-placeholder-shown:hidden hover:bg-surface-raised hover:text-ink"
      >
        <XIcon />
      </button>
      <kbd
        aria-hidden="true"
        className="pointer-events-none absolute end-2 top-1/2 hidden min-w-5 -translate-y-1/2 rounded border border-line bg-surface-raised px-1 text-center font-mono text-xs leading-5 text-ink-muted peer-[:placeholder-shown:not(:focus)]:block"
      >
        /
      </kbd>
    </div>
  );
}

/** Narrows the grid to repositories with changes or out of sync, counting each choice. */
function FilterPicker({
  repositories,
  filter,
  query,
}: {
  readonly repositories: ReadonlyArray<Repository>;
  readonly filter: RepositoryFilter;
  readonly query: string;
}) {
  const navigate = useNavigate({ from: "/" });

  return (
    <fieldset className="flex rounded-md border border-line bg-surface p-0.5">
      <legend className="sr-only">Show</legend>
      {filters.map(({ value, label, symbol }) => (
        <label
          key={value}
          title={label}
          className="flex cursor-pointer items-baseline gap-1.5 rounded px-2.5 py-1.5 text-sm text-ink-muted hover:text-ink has-checked:bg-accent-soft has-checked:text-ink has-checked:ring-1 has-checked:ring-accent/60 has-checked:ring-inset has-focus-visible:outline-2 has-focus-visible:outline-accent"
        >
          <input
            type="radio"
            name="filter"
            value={value}
            checked={filter === value}
            onChange={() => {
              void navigate({
                search: ({ filter: _previous, ...rest }) =>
                  value === "all" ? rest : { ...rest, filter: value },
                replace: true,
              });
            }}
            className="sr-only"
          />
          {symbol === null ? (
            label
          ) : (
            <>
              <span aria-hidden="true" className={symbol.className}>
                {symbol.text}
              </span>
              <span className="sr-only">{label},</span>
            </>
          )}
          <span className="tabular-nums">
            {
              repositories.filter((repository) =>
                repositoryMatches({ repository, filter: value, query }),
              ).length
            }
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Search and filters on the left, the fleet-wide actions on the right. */
export function ProjectToolbar({
  hub,
  repositories,
  filter,
  query,
}: {
  readonly hub: HubState;
  readonly repositories: ReadonlyArray<Repository>;
  readonly filter: RepositoryFilter;
  readonly query: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <SearchField query={query} />
      <FilterPicker repositories={repositories} filter={filter} query={query} />
      <div className="ms-auto">
        <FleetActions hub={hub} />
      </div>
    </div>
  );
}
