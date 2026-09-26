import { useEffect, useId } from "react";

import { selectionKey } from "../ProjectGrid.tsx";
import { CellPanel } from "./CellPanel.tsx";
import { FleetOverview } from "./FleetOverview.tsx";
import { PanelHeader } from "./PanelHeader.tsx";
import { RepositoryPanel } from "./RepositoryPanel.tsx";

import type { Fleet } from "@fleetfrog/protocol/domain/fleet";

import type { ProjectSelection, SelectionHistory } from "../ProjectGrid.tsx";

/**
 * Moves focus to the panel's heading when the panel covers the page on narrow screens, or when
 * whatever had focus went away with the panel's previous contents. Keyed on the selection, it
 * mounts, and so runs, each time the panel shows something new.
 */
function FocusHeading({ targetId }: { readonly targetId: string }) {
  useEffect(() => {
    const focusLost = document.activeElement === null || document.activeElement === document.body;

    if (focusLost || !window.matchMedia("(min-width: 64rem)").matches) {
      document.getElementById(targetId)?.focus();
    }
  }, [targetId]);

  return null;
}

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
  const key = selectionKey(selection);

  return (
    <aside
      id={projectPanelId}
      aria-labelledby={headingId}
      className={`fixed inset-0 z-10 lg:relative lg:inset-auto lg:z-auto ${panelClassName}`}
    >
      <FocusHeading key={key} targetId={headingId} />
      {repository === undefined && (
        <>
          <PanelHeader headingId={headingId} title="Repository not found" onClose={onClose} />
          <p className="px-5 text-sm text-ink-muted">
            No machine has it any more, or it was matched with another repository.
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
