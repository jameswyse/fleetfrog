import { Link, useNavigate, useSearch } from "@tanstack/react-router";

import { knownFleet, useHub } from "@/rpc/hubConnection.ts";

import { repositoryMatches } from "./checkoutSummary.ts";
import { FleetActions } from "./FleetActions.tsx";
import { projectPanelId, ProjectPanel } from "./panel/ProjectPanel.tsx";
import { ProjectGrid, selectionKey } from "./ProjectGrid.tsx";

import type { RepositoryFilter } from "./checkoutSummary.ts";
import type { ProjectSelection, SelectionHistory } from "./ProjectGrid.tsx";

const filters: ReadonlyArray<{ readonly value: RepositoryFilter; readonly label: string }> = [
  { value: "all", label: "All" },
  { value: "changes", label: "Has changes" },
  { value: "out-of-sync", label: "Out of sync" },
];

/** Use heading level 2 inside a page that already has its own h1. */
function EmptyState({
  title,
  level = 1,
  children,
}: {
  readonly title: string;
  readonly level?: 1 | 2;
  readonly children: React.ReactNode;
}) {
  const Heading = level === 1 ? "h1" : "h2";

  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <Heading className="text-lg font-semibold">{title}</Heading>
      <div className="mt-2 text-sm text-ink-muted">{children}</div>
    </div>
  );
}

/**
 * Every repository on every machine as a grid, with a panel beside it for whatever is chosen. On
 * wide screens the page fills the window below the header and the grid scrolls inside it, so its
 * headings stay in view.
 */
export function ProjectsPage() {
  const hub = useHub();
  const search = useSearch({ from: "/_app/" });
  const navigate = useNavigate({ from: "/" });
  const filter = search.filter ?? "all";
  const query = search.q ?? "";

  const fleet = knownFleet(hub);

  if (fleet === null) {
    return (
      <EmptyState
        title={hub._tag === "Connecting" ? "Connecting to the hub…" : "Can't reach the hub"}
      >
        {hub._tag === "Connecting"
          ? "Loading your fleet."
          : "The dashboard will reconnect as soon as the hub is running again."}
      </EmptyState>
    );
  }

  const { machines, repositories } = fleet;

  if (machines.length === 0) {
    return (
      <EmptyState title="No machines yet">
        Pair a development machine and its repositories will appear here.
        <div className="mt-5">
          <Link
            to="/settings/fleet/pair"
            className="inline-flex min-h-9 items-center rounded-md bg-accent px-3 text-sm font-medium text-accent-ink"
          >
            Pair a machine
          </Link>
        </div>
      </EmptyState>
    );
  }

  const visible = repositories.filter((repository) =>
    repositoryMatches({ repository, filter, query }),
  );
  const selection: ProjectSelection | null =
    search.repo === undefined ? null : { repository: search.repo, machine: search.machine ?? null };

  const select = (next: ProjectSelection, history: SelectionHistory) => {
    void navigate({
      search: ({ repo: _repo, machine: _machine, path: _path, ...rest }) =>
        next.machine === null
          ? { ...rest, repo: next.repository }
          : { ...rest, repo: next.repository, machine: next.machine },
      replace: history === "Replace",
    });
  };

  const close = () => {
    const panelHadFocus = (document.activeElement?.closest(`#${projectPanelId}`) ?? null) !== null;

    void navigate({ search: ({ repo: _repo, machine: _machine, path: _path, ...rest }) => rest });

    // Focus returns to what opened the panel, rather than falling back to the page.
    if (panelHadFocus && selection !== null) {
      document
        .querySelector<HTMLElement>(`[data-selection="${CSS.escape(selectionKey(selection))}"]`)
        ?.focus();
    }
  };

  return (
    <div
      onKeyDown={(event) => {
        const inDialog =
          event.target instanceof Element && event.target.closest("dialog, [popover]") !== null;

        if (event.key === "Escape" && selection !== null && !inDialog) {
          close();
        }
      }}
      className="lg:flex lg:h-[calc(100dvh-var(--app-header-height))]"
    >
      <div className="flex min-w-0 flex-1 flex-col px-4 pt-5 pb-4 sm:px-6">
        <div className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <h1 className="text-lg font-semibold">Projects</h1>
            <p className="text-sm text-ink-muted">
              {visible.length === repositories.length ? "" : `${visible.length} of `}
              {repositories.length} {repositories.length === 1 ? "repository" : "repositories"}{" "}
              across {machines.length} {machines.length === 1 ? "machine" : "machines"}
            </p>
          </div>
          <div className="ms-auto flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <span className="text-ink-muted">Find</span>
                <input
                  type="search"
                  // Uncontrolled: the router commits search updates in a transition, so a controlled
                  // value would lag behind typing and move the caret.
                  defaultValue={query}
                  placeholder="Repository name"
                  onChange={(event) => {
                    const q = event.currentTarget.value;

                    void navigate({
                      search: ({ q: _previous, ...rest }) => (q === "" ? rest : { ...rest, q }),
                      replace: true,
                    });
                  }}
                  className="min-h-9 w-52 rounded-md border border-line bg-surface px-2.5"
                />
              </label>
              <fieldset className="flex rounded-md border border-line bg-surface p-0.5">
                <legend className="sr-only">Show</legend>
                {filters.map(({ value, label }) => (
                  <label
                    key={value}
                    className="cursor-pointer rounded px-3 py-1.5 text-sm text-ink-muted has-checked:bg-surface-raised has-checked:text-ink has-focus-visible:outline-2 has-focus-visible:outline-accent"
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
                    {label}
                  </label>
                ))}
              </fieldset>
            </div>
            <FleetActions hub={hub} />
          </div>
        </div>
        {repositories.length === 0 && (
          <EmptyState title="Waiting for the first scan" level={2}>
            Repositories appear once an agent finishes searching its project folders.
          </EmptyState>
        )}
        {repositories.length > 0 && visible.length === 0 && (
          <p className="py-16 text-center text-sm text-ink-muted">No repositories match.</p>
        )}
        {visible.length > 0 && (
          <ProjectGrid
            fleet={fleet}
            repositories={visible}
            selection={selection}
            onSelect={select}
          />
        )}
      </div>
      {selection !== null && (
        <ProjectPanel
          fleet={fleet}
          selection={selection}
          path={search.path ?? null}
          onSelect={select}
          onChoosePath={(path) => {
            void navigate({ search: (previous) => ({ ...previous, path }), replace: true });
          }}
          onClose={close}
        />
      )}
    </div>
  );
}
