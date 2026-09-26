import { useEffect, useId } from "react";

import { selectionKey } from "../ProjectGrid.tsx";
import { CellPanel } from "./CellPanel.tsx";
import { PanelHeader } from "./PanelHeader.tsx";
import { RepositoryPanel } from "./RepositoryPanel.tsx";

import type { Fleet } from "@fleetfrog/protocol/domain/fleet";

import type { ProjectSelection, SelectionHistory } from "../ProjectGrid.tsx";

/**
 * Moves focus to the panel's heading when the panel covers the page on narrow screens. Keyed on the
 * selection, it mounts, and so moves focus, each time the panel shows something new.
 */
function FocusOnNarrowScreens({ targetId }: { readonly targetId: string }) {
  useEffect(() => {
    if (!window.matchMedia("(min-width: 64rem)").matches) {
      document.getElementById(targetId)?.focus();
    }
  }, [targetId]);

  return null;
}

/** The panel's element id, for telling whether focus is inside it. */
export const projectPanelId = "project-panel";

/**
 * The side panel beside the grid: a repository on every machine, or on one machine. On wide
 * screens it sits beside the grid, which stays usable; on narrow ones it covers the page.
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
  readonly selection: ProjectSelection;
  readonly path: string | null;
  readonly onSelect: (selection: ProjectSelection, history: SelectionHistory) => void;
  readonly onChoosePath: (path: string) => void;
  readonly onClose: () => void;
}) {
  const headingId = useId();
  const repository = fleet.repositories.find(({ key }) => key === selection.repository);
  const machine = fleet.machines.find(({ id }) => id === selection.machine);
  const key = selectionKey(selection);

  return (
    <aside
      id={projectPanelId}
      aria-labelledby={headingId}
      className="fixed inset-0 z-10 overflow-y-auto bg-surface lg:static lg:z-auto lg:h-full lg:w-[30rem] lg:shrink-0 lg:border-s lg:border-line"
    >
      <FocusOnNarrowScreens key={key} targetId={headingId} />
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
