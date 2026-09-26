import { useRuns } from "@/rpc/hubConnection.ts";
import { gitHost, HostIcon } from "@/ui/HostIcon.tsx";
import { MachineKindIcon } from "@/ui/MachineKindIcon.tsx";
import { machineKind, machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { activeCloneFor, activeRunFor } from "../actions/runLookup.ts";
import { RunStateText } from "../actions/RunStateText.tsx";
import { CellContent } from "./CellContent.tsx";
import { summariseCell } from "./cellSummary.ts";
import { MachineActions } from "./MachineActions.tsx";
import { RepositoryActions } from "./RepositoryActions.tsx";

import type { KeyboardEvent } from "react";

import type { RunsSnapshot } from "@fleetfrog/protocol/domain/activity";
import type { Fleet, Machine, Repository } from "@fleetfrog/protocol/domain/fleet";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";
import type { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

/** What the side panel shows: a repository on every machine, or on one machine. */
export interface ProjectSelection {
  readonly repository: RepositoryKey;
  readonly machine: MachineId | null;
}

/** Whether a change of selection adds a history entry or replaces the current one. */
export type SelectionHistory = "Push" | "Replace";

/** Names the grid button for a selection, so focus can return to it when the panel closes. */
export function selectionKey(selection: ProjectSelection): string {
  return `${selection.repository}|${selection.machine ?? ""}`;
}

/** Offline columns sit on the canvas colour so their last known state reads as stale. */
function columnBackground(machine: Machine): string {
  return machine.connection._tag === "Offline" ? "bg-canvas" : "bg-surface";
}

/** Machine columns have a fixed width, so a long branch or machine name is cut short, not widened. */
const columnWidth = "w-52";

/**
 * Every cell is at least two lines tall, so rows line up whether or not a cell has a second line.
 * Cells are 1px tall to start with, which a table grows to the row's height, so their contents can
 * fill the row with a full height.
 */
const cellHeight = "min-h-[3.375rem]";

function stepFor(key: string): readonly [number, number] | null {
  switch (key) {
    case "ArrowUp":
      return [-1, 0];
    case "ArrowDown":
      return [1, 0];
    case "ArrowLeft":
      return [0, -1];
    case "ArrowRight":
      return [0, 1];
    default:
      return null;
  }
}

function MachineHeader({ fleet, machine }: { readonly fleet: Fleet; readonly machine: Machine }) {
  const label = machineLabel(machine);
  const online = machine.connection._tag === "Online";

  return (
    <th
      scope="col"
      className={`border-b border-line p-0 text-start align-bottom font-normal ${columnBackground(machine)}`}
    >
      <div className={`flex ${columnWidth} items-center gap-2 px-3 py-2`}>
        <span
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-full ${online ? "bg-clean" : "bg-ink-muted"}`}
        />
        <MachineKindIcon kind={machineKind(machine)} className="text-ink-muted" />
        <span className="min-w-0 flex-1 truncate font-semibold" title={label}>
          {label}
        </span>
        <span className="sr-only">{online ? ", online" : ", offline"}</span>
        <MachineActions fleet={fleet} machine={machine} />
      </div>
    </th>
  );
}

function MatrixCell({
  repository,
  machine,
  runs,
  position,
  selected,
  onSelect,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
  readonly runs: RunsSnapshot;
  /** `<row>:<column>` for moving between cells with the arrow keys. */
  readonly position: string;
  readonly selected: boolean;
  readonly onSelect: (selection: ProjectSelection, history: SelectionHistory) => void;
}) {
  const cell = summariseCell(
    repository.checkouts.filter(({ machineId }) => machineId === machine.id),
  );
  const offline = machine.connection._tag === "Offline";

  if (cell === null) {
    const cloning = activeCloneFor(runs, { machineId: machine.id, repositoryKey: repository.key });

    return (
      <td className={`border-b border-line p-0 align-top ${columnBackground(machine)}`}>
        <div className={`${cellHeight} ${columnWidth} px-3 py-2 text-sm text-ink-muted`}>
          {cloning !== undefined && (
            <span className="flex text-xs">
              <RunStateText run={cloning} length="short" />
            </span>
          )}
          {cloning === undefined && machine.lastDiscoveryAt === null && (
            <span className="italic">Not scanned</span>
          )}
          {cloning === undefined && machine.lastDiscoveryAt !== null && (
            <>
              <span aria-hidden="true">·</span>
              <span className="sr-only">
                {offline ? "Not on this machine at the last scan" : "Not on this machine"}
              </span>
            </>
          )}
        </div>
      </td>
    );
  }

  const active = cell.entries
    .map(({ checkout }) => activeRunFor(runs, { machineId: machine.id, checkout }))
    .find((run) => run !== undefined);
  const selection = { repository: repository.key, machine: machine.id };

  return (
    <td
      className={`h-px border-b border-line p-0 align-top ${cell.problem === null ? columnBackground(machine) : "bg-danger-soft"}`}
    >
      <button
        type="button"
        data-cell={position}
        data-selection={selectionKey(selection)}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(selection, "Push")}
        className={`block h-full ${cellHeight} ${columnWidth} px-3 py-2 text-start -outline-offset-2 hover:bg-surface-raised aria-[current=true]:ring-2 aria-[current=true]:ring-accent aria-[current=true]:ring-inset ${offline ? "opacity-75" : ""}`}
      >
        <CellContent
          cell={cell}
          activity={
            active === undefined ? null : (
              <span className="mt-0.5 flex text-xs">
                <RunStateText run={active} length="short" />
              </span>
            )
          }
        />
        {offline && <span className="sr-only">, last known state, machine offline</span>}
      </button>
    </td>
  );
}

/**
 * Repositories down the side and machines across the top, one short cell for each repository on
 * each machine. Choosing a repository or a cell opens it in the side panel; the arrow keys move
 * between them, and follow along in the panel while it is open.
 */
export function ProjectGrid({
  fleet,
  repositories,
  selection,
  onSelect,
}: {
  readonly fleet: Fleet;
  /** The repositories to show, which the page may have filtered. */
  readonly repositories: ReadonlyArray<Repository>;
  readonly selection: ProjectSelection | null;
  readonly onSelect: (selection: ProjectSelection, history: SelectionHistory) => void;
}) {
  const runs = useRuns();
  const { machines } = fleet;

  const moveFocus = (event: KeyboardEvent<HTMLTableSectionElement>) => {
    const step = stepFor(event.key);
    const origin = event.target instanceof HTMLElement ? event.target.dataset.cell : undefined;

    if (step === null || origin === undefined) {
      return;
    }

    const [row = 0, column = 0] = origin.split(":").map(Number);
    const [rowStep, columnStep] = step;

    event.preventDefault();

    // Skip cells with nothing to open, such as a repository missing from a machine.
    for (
      let [nextRow, nextColumn] = [row + rowStep, column + columnStep];
      nextRow >= 0 &&
      nextRow < repositories.length &&
      nextColumn >= 0 &&
      nextColumn <= machines.length;
      nextRow += rowStep, nextColumn += columnStep
    ) {
      const target = event.currentTarget.querySelector<HTMLElement>(
        `[data-cell="${nextRow}:${nextColumn}"]`,
      );
      const repository = repositories[nextRow];

      if (target !== null && repository !== undefined) {
        target.focus();

        if (selection !== null) {
          onSelect(
            { repository: repository.key, machine: machines[nextColumn - 1]?.id ?? null },
            "Replace",
          );
        }

        return;
      }
    }
  };

  return (
    // Positioned so screen-reader text in the cells is clipped here instead of widening the page.
    <div className="relative w-fit max-w-full overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="border-separate border-spacing-0 text-sm">
        <caption className="sr-only">
          Repositories by machine. Choose a repository or a cell to see its details.
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky start-0 z-[3] border-e border-b border-line bg-surface px-4 py-2 text-start align-bottom font-semibold"
            >
              Repository
            </th>
            {machines.map((machine) => (
              <MachineHeader key={machine.id} fleet={fleet} machine={machine} />
            ))}
          </tr>
        </thead>
        <tbody onKeyDown={moveFocus}>
          {repositories.map((repository, row) => {
            const rowSelection = { repository: repository.key, machine: null };
            const host = gitHost(repository.identity);
            const identity =
              repository.identity._tag === "Remote"
                ? `${host.name}: ${repository.identity.path}`
                : host.name;

            return (
              <tr key={repository.key}>
                <th
                  scope="row"
                  className="sticky start-0 z-[1] border-e border-b border-line bg-surface p-0 text-start align-top font-medium"
                >
                  <div className="flex w-60 items-center gap-1 pe-2">
                    <button
                      type="button"
                      data-cell={`${row}:0`}
                      data-selection={selectionKey(rowSelection)}
                      aria-current={
                        selection?.repository === repository.key && selection.machine === null
                          ? "true"
                          : undefined
                      }
                      onClick={() => onSelect(rowSelection, "Push")}
                      title={identity}
                      className="flex min-w-0 flex-1 items-center gap-2 px-4 py-2 text-start -outline-offset-2 hover:underline aria-[current=true]:text-accent"
                    >
                      <HostIcon host={host} className="text-ink-muted" />
                      <span className="min-w-0 truncate">{repository.name}</span>
                    </button>
                    <RepositoryActions fleet={fleet} repository={repository} />
                  </div>
                </th>
                {machines.map((machine, index) => (
                  <MatrixCell
                    key={machine.id}
                    repository={repository}
                    machine={machine}
                    runs={runs}
                    position={`${row}:${index + 1}`}
                    selected={
                      selection?.repository === repository.key && selection.machine === machine.id
                    }
                    onSelect={onSelect}
                  />
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
