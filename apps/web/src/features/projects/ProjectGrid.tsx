import { BotIcon, ChevronDownIcon } from "lucide-react";

import { useRuns } from "@/rpc/hubConnection.ts";
import { gitHost, HostIcon } from "@/ui/HostIcon.tsx";
import { MachineKindIcon } from "@/ui/MachineKindIcon.tsx";
import { ProjectIcon } from "@/ui/ProjectIcon.tsx";
import { machineKind, machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { RunActivity } from "../actions/RunActivity.tsx";
import { activeRunOn } from "../actions/runLookup.ts";
import { busyThreads } from "../t3Code/t3CodeLookup.ts";
import { CellContent } from "./CellContent.tsx";
import { cellFor } from "./cellSummary.ts";
import { MachineActions } from "./MachineActions.tsx";
import { MissingCellContent } from "./MissingCell.tsx";
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

/** The grid button for a selection, if the grid shows it. */
export function findGridCell(selection: ProjectSelection): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-selection="${CSS.escape(selectionKey(selection))}"]`,
  );
}

/** Offline columns sit on the canvas colour so their last known state reads as stale. */
function columnBackground(machine: Machine): string {
  return machine.connection._tag === "Offline" ? "bg-canvas" : "bg-surface";
}

/**
 * Machine columns start at a fixed width, so a long branch or machine name is cut short, not
 * widened. When the grid has room to spare, the columns share it.
 */
const columnWidth = "w-52 min-w-full";

/**
 * The repository column grows with its longest name, up to a limit, and gives that width back
 * before the grid scrolls sideways. Its header sets the limit as the column's width, so spare room
 * goes to the machine columns. The name's grid track lets it shrink to nothing, so only the
 * minimum width holds the column open when space is short.
 */
const nameColumnWidth = "min-w-60 max-w-sm";
const shrinkableName = "grid min-w-0 grid-cols-[minmax(0,max-content)]";

/**
 * Every cell is at least two lines tall, so rows line up whether or not a cell has a second line.
 * Cells are 1px tall to start with, which a table grows to the row's height, so their contents can
 * fill the row with a full height.
 */
const cellHeight = "min-h-[3.375rem]";

/**
 * Keyboard focus and selection draw the same single ring, so a focused, selected cell shows one
 * border, not two.
 */
const focusRing =
  "outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset";

const selectedRing =
  "aria-[current=true]:ring-2 aria-[current=true]:ring-accent aria-[current=true]:ring-inset";

/** A chosen repository's whole row. */
const selectedRowBackground = "bg-accent-soft";

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
      className={`sticky top-0 z-[2] border-b border-line p-0 text-center align-middle font-normal ${columnBackground(machine)}`}
    >
      {/* The whole header opens the machine's menu. */}
      <MachineActions
        fleet={fleet}
        machine={machine}
        trigger={{
          // As tall as the header row, whose height the grid's scroll padding allows for.
          className: `group relative flex min-h-12 ${columnWidth} items-center justify-center gap-2 px-7 hover:bg-surface-raised ${focusRing}`,
          content: (
            <>
              <span
                aria-hidden="true"
                className={`size-2 shrink-0 rounded-full ${online ? "bg-clean" : "bg-ink-muted"}`}
              />
              <MachineKindIcon kind={machineKind(machine)} className="text-ink-muted" />
              <span className="min-w-0 truncate font-semibold" title={label}>
                {label}
              </span>
              <span className="sr-only">{online ? ", online" : ", offline"}</span>
              <ChevronDownIcon
                aria-hidden="true"
                className="absolute end-2 text-ink-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
              />
            </>
          ),
        }}
      />
    </th>
  );
}

function MatrixCell({
  repository,
  machine,
  runs,
  position,
  selected,
  rowSelected,
  onSelect,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
  readonly runs: RunsSnapshot;
  /** `<row>:<column>` for moving between cells with the arrow keys. */
  readonly position: string;
  readonly selected: boolean;
  /** The cell's repository is chosen as a whole, which tints its row. */
  readonly rowSelected: boolean;
  readonly onSelect: (selection: ProjectSelection, history: SelectionHistory) => void;
}) {
  const background = rowSelected ? selectedRowBackground : columnBackground(machine);
  const cell = cellFor(repository, machine.id);
  const offline = machine.connection._tag === "Offline";
  const active = cell === null ? undefined : activeRunOn(runs, cell.entries);

  const [agent] =
    cell === null
      ? []
      : busyThreads(
          machine,
          cell.entries.map(({ checkout }) => checkout.path),
        );

  const selection = { repository: repository.key, machine: machine.id };

  return (
    <td
      className={`h-px border-b border-line p-0 align-middle ${cell === null || cell.problem === null ? background : "bg-danger-soft"}`}
    >
      {/* Every cell can be chosen, including one the machine lacks, so the arrow keys reach it. */}
      <button
        type="button"
        data-cell={position}
        data-selection={selectionKey(selection)}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(selection, "Push")}
        className={`flex h-full ${cellHeight} ${columnWidth} flex-col items-center justify-center px-3 py-2 text-center hover:bg-surface-raised ${focusRing} ${selectedRing} ${offline ? "opacity-75" : ""}`}
      >
        {cell === null ? (
          <MissingCellContent repository={repository} machine={machine} runs={runs} />
        ) : (
          <span className="w-full min-w-0">
            <CellContent
              cell={cell}
              align="Center"
              activity={
                active === undefined ? (
                  agent === undefined ? null : (
                    // A T3 Code agent at work here is the next most useful thing to see.
                    <span
                      className="mt-0.5 flex items-center justify-center gap-1 text-xs text-sync"
                      title={`T3 Code: ${agent.title}`}
                    >
                      <BotIcon aria-hidden="true" className="size-3.5" />
                      <span className="sr-only">T3 Code </span>
                      {agent.state === "Waiting" ? "Waiting for you" : "Working"}
                    </span>
                  )
                ) : (
                  <span className="mt-0.5 block text-xs">
                    <RunActivity run={active} layout="Inline" align="Center" />
                  </span>
                )
              }
            />
          </span>
        )}
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

    const [nextRow, nextColumn] = [row + rowStep, column + columnStep];

    const target = event.currentTarget.querySelector<HTMLElement>(
      `[data-cell="${nextRow}:${nextColumn}"]`,
    );

    const repository = repositories[nextRow];

    // Past the grid's edge there is no cell, so focus stays put.
    if (target === null || repository === undefined) {
      return;
    }

    target.focus();

    if (selection !== null) {
      onSelect(
        { repository: repository.key, machine: machines[nextColumn - 1]?.id ?? null },
        "Replace",
      );
    }
  };

  return (
    // Scrolls both ways under its pinned header row and repository column, which the scroll padding
    // keeps a focused cell clear of. Positioned so screen-reader text in the cells is clipped here
    // instead of widening the page.
    <div className="relative min-h-0 w-full max-w-projects scroll-pt-[3.0625rem] scroll-ps-[min(24rem,40%)] overflow-auto rounded-lg border border-line bg-surface">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <caption className="sr-only">
          Repositories by machine. Choose a repository or a cell to see its details.
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky start-0 top-0 z-[3] w-sm border-e border-b border-line bg-surface px-4 py-2 text-start align-middle font-semibold"
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

            const rowSelected =
              selection?.repository === repository.key && selection.machine === null;

            return (
              <tr key={repository.key}>
                <th
                  scope="row"
                  className={`sticky start-0 z-[1] h-px border-e border-b border-line p-0 text-start align-middle font-medium ${rowSelected ? selectedRowBackground : "bg-surface"}`}
                >
                  <div className={`flex h-full ${nameColumnWidth} items-center gap-1 pe-2`}>
                    <button
                      type="button"
                      data-cell={`${row}:0`}
                      data-selection={selectionKey(rowSelection)}
                      aria-current={rowSelected ? "true" : undefined}
                      onClick={() => onSelect(rowSelection, "Push")}
                      title={identity}
                      className={`group flex min-w-0 flex-1 items-center gap-2 self-stretch px-4 py-2 text-start aria-[current=true]:text-accent-text ${rowSelected ? "outline-hidden" : focusRing}`}
                    >
                      {repository.icon === null ? (
                        <>
                          <HostIcon host={host} className="text-ink-muted" />
                          <span className={shrinkableName}>
                            <span className="truncate group-hover:underline">
                              {repository.label}
                            </span>
                          </span>
                        </>
                      ) : (
                        // T3 Code's name leads, with the repository it stands for beneath it. Both
                        // icons share a column, and both lines start at the same edge.
                        <span className="grid min-w-0 grid-cols-[1rem_minmax(0,max-content)] items-center gap-x-2 gap-y-0.5">
                          <ProjectIcon icon={repository.icon} />
                          <span className="truncate group-hover:underline">{repository.label}</span>
                          <HostIcon
                            host={host}
                            className="size-3 justify-self-center text-ink-muted"
                          />
                          <span className="truncate text-xs font-normal text-ink-muted">
                            {repository.identity._tag === "Remote"
                              ? repository.identity.path
                              : repository.name}
                          </span>
                        </span>
                      )}
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
                    rowSelected={rowSelected}
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
