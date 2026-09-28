import { useId } from "react";

import { Link } from "@tanstack/react-router";

import { useRole } from "@/rpc/session.ts";

import { selectionKey } from "../ProjectGrid.tsx";
import { CellPanel } from "./CellPanel.tsx";
import { FleetOverview } from "./FleetOverview.tsx";
import { FocusHeading } from "./FocusHeading.tsx";
import { PanelHeader } from "./PanelHeader.tsx";
import { RepositoryPanel } from "./RepositoryPanel.tsx";

import type { Fleet } from "@fleetfrog/protocol/domain/fleet";

import type { ProjectSelection, SelectionHistory } from "../ProjectGrid.tsx";

/** The panel's element id, for telling whether focus is inside it. */
export const projectPanelId = "project-panel";

/**
 * Classes both panels share. Each also positions itself in every layout, so screen-reader text
 * inside stays within the panel rather than stretching the window.
 */
const panelClassName =
  "overflow-y-auto bg-surface lg:w-[30rem] lg:shrink-0 lg:border-s lg:border-line";

/**
 * The side panel: a repository on every machine, on one machine, or the whole fleet when nothing
 * is chosen. On wide screens it is always open beside the grid, full height, and scrolls on its
 * own; on narrow ones it covers the page while something is chosen.
 */
export function ProjectPanel({
  fleet,
  selection,
  path,
  onSelect,
  onChoosePath,
  onClose,
}: {
  readonly fleet: Fleet;
  readonly selection: ProjectSelection | null;
  readonly path: string | null;
  readonly onSelect: (selection: ProjectSelection, history: SelectionHistory) => void;
  readonly onChoosePath: (path: string) => void;
  readonly onClose: () => void;
}) {
  const headingId = useId();
  const role = useRole();

  if (selection === null) {
    return (
      <aside
        id={projectPanelId}
        aria-labelledby={headingId}
        className={`relative hidden lg:block ${panelClassName}`}
      >
        <FleetOverview fleet={fleet} headingId={headingId} onSelect={onSelect} />
      </aside>
    );
  }

  const repository = fleet.repositories.find(({ key }) => key === selection.repository);
  const machine = fleet.machines.find(({ id }) => id === selection.machine);
  const archived = fleet.archive.some(({ key }) => key === selection.repository);
  const key = selectionKey(selection);

  return (
    <aside
      id={projectPanelId}
      aria-labelledby={headingId}
      className={`fixed inset-0 z-10 lg:relative lg:inset-auto lg:z-auto ${panelClassName}`}
    >
      {/* Keyed on the selection, so it runs each time the panel shows something new. */}
      <FocusHeading key={`focus:${key}`} targetId={headingId} />
      {repository === undefined && (
        <>
          <PanelHeader
            headingId={headingId}
            title={archived ? "Repository archived" : "Repository not found"}
            onClose={onClose}
          />
          <p className="px-5 text-sm text-ink-muted">
            {archived ? (
              <>
                Every checkout of it is in the Archive folder.
                {role === "admin" && (
                  <>
                    {" "}
                    <Link
                      to="/cleanup/archive"
                      className="text-accent-text underline-offset-2 hover:underline"
                    >
                      See the archive
                    </Link>
                  </>
                )}
              </>
            ) : (
              "No machine has it any more, or it was matched with another repository."
            )}
          </p>
        </>
      )}
      {repository !== undefined && machine === undefined && (
        <RepositoryPanel
          fleet={fleet}
          repository={repository}
          headingId={headingId}
          onSelect={onSelect}
          onClose={onClose}
        />
      )}
      {repository !== undefined && machine !== undefined && (
        <CellPanel
          key={key}
          fleet={fleet}
          repository={repository}
          machine={machine}
          path={path}
          headingId={headingId}
          onSelect={onSelect}
          onChoosePath={onChoosePath}
          onClose={onClose}
        />
      )}
    </aside>
  );
}
