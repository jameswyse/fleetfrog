import { Link, useNavigate, useSearch } from "@tanstack/react-router";

import { knownFleet, useHub } from "@/rpc/hubConnection.ts";
import { useRole } from "@/rpc/session.ts";

import { repositoryMatches } from "./checkoutSummary.ts";
import { projectPanelId, ProjectPanel } from "./panel/ProjectPanel.tsx";
import { findGridCell, ProjectGrid } from "./ProjectGrid.tsx";
import { arrangeProjects } from "./projectLayout.ts";
import { useProjectLayout } from "./projectLayoutStore.ts";
import { ProjectToolbar } from "./ProjectToolbar.tsx";

import type { ReactNode } from "react";

import type { Repository } from "@fleetfrog/protocol/domain/fleet";

import type { ProjectSelection, SelectionHistory } from "./ProjectGrid.tsx";

function EmptyState({
  title,
  level = 1,
  children,
}: {
  readonly title: string;
  readonly level?: 1 | 2;
  readonly children: ReactNode;
}) {
  const Heading = level === 1 ? "h1" : "h2";

  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <Heading className="text-lg font-semibold">{title}</Heading>
      <div className="mt-2 text-sm text-ink-muted">{children}</div>
    </div>
  );
}

export function ProjectsPage() {
  const hub = useHub();
  const role = useRole();
  const search = useSearch({ from: "/_app/" });
  const navigate = useNavigate({ from: "/" });
  const filter = search.filter ?? "all";
  const query = search.q ?? "";
  const layout = useProjectLayout();

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
        {role === "admin" ? (
          <>
            Pair a development machine and its repositories will appear here.
            <div className="mt-5">
              <Link
                to="/settings/fleet/pair"
                className="inline-flex min-h-9 items-center rounded-md bg-accent px-3 text-sm font-medium text-accent-ink hover:bg-accent-hover"
              >
                Pair a machine
              </Link>
            </div>
          </>
        ) : (
          "Once an admin pairs a development machine, its repositories will appear here."
        )}
      </EmptyState>
    );
  }

  const searching = query.trim() !== "";

  const arrange = (dragging: Repository | null) =>
    arrangeProjects({
      repositories,
      layout,
      matches: (repository) => repositoryMatches({ repository, filter, query }),
      filtering: searching || filter !== "all",
      searching,
      dragging,
    });

  const arrangement = arrange(null);

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

    findGridCell(next)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const close = () => {
    const panelHadFocus = (document.activeElement?.closest(`#${projectPanelId}`) ?? null) !== null;

    void navigate({
      search: ({ repo: _repo, machine: _machine, path: _path, ...rest }) => rest,
    });

    if (panelHadFocus && selection !== null) {
      findGridCell(selection)?.focus();
    }
  };

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape closes the side panel from anywhere on the page outside a dialog or popover.
    <div
      data-fills-viewport
      className="flex min-h-0 flex-1 flex-col lg:flex-row"
      onKeyDown={(event) => {
        const inDialog =
          event.target instanceof Element && event.target.closest("dialog, [popover]") !== null;

        if (event.key === "Escape" && selection !== null && !inDialog) {
          close();
        }
      }}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 px-4 pt-3 pb-4 sm:px-6">
        <h1 className="sr-only">Projects</h1>
        <ProjectToolbar hub={hub} repositories={repositories} filter={filter} query={query} />
        {repositories.length === 0 && (
          <EmptyState title="Waiting for the first scan" level={2}>
            Repositories appear once an agent finishes searching its project folders.
          </EmptyState>
        )}
        {repositories.length > 0 && arrangement.sections.length === 0 && (
          <p className="py-16 text-center text-sm text-ink-muted">No repositories match.</p>
        )}
        {arrangement.sections.length > 0 && (
          <ProjectGrid
            fleet={fleet}
            arrange={arrange}
            live={hub._tag === "Live"}
            searching={searching}
            selection={selection}
            onSelect={select}
          />
        )}
      </div>
      <ProjectPanel
        fleet={fleet}
        selection={selection}
        path={search.path ?? null}
        onSelect={select}
        onChoosePath={(path) => {
          void navigate({
            search: (previous) => ({ ...previous, path }),
            replace: true,
          });
        }}
        onClose={close}
      />
    </div>
  );
}
