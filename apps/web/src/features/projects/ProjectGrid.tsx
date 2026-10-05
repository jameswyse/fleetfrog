import { useId, useState } from "react";

import { BotIcon, ChevronDownIcon, ChevronRightIcon, FolderIcon, PinIcon } from "lucide-react";

import { useRuns } from "@/rpc/hubConnection.ts";
import { gitHost, HostIcon } from "@/ui/HostIcon.tsx";
import { MachineKindIcon } from "@/ui/MachineKindIcon.tsx";
import { ProjectIcon } from "@/ui/ProjectIcon.tsx";
import { machineKind, machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { RunActivity } from "../actions/RunActivity.tsx";
import { activeRunOn } from "../actions/runLookup.ts";
import { changeProjectLayout, usePreferences } from "../preferences/preferences.ts";
import { busyThreads } from "../t3Code/t3CodeLookup.ts";
import { CellContent } from "./CellContent.tsx";
import { cellFor } from "./cellSummary.ts";
import { repositoryMatches } from "./checkoutSummary.ts";
import { GroupDialog } from "./GroupDialog.tsx";
import { setCollapsed, setPinned } from "./layoutChanges.ts";
import { MachineActions } from "./MachineActions.tsx";
import { MissingCellContent } from "./MissingCell.tsx";
import { sectionTitle, visibleRows } from "./projectLayout.ts";
import { RepositoryActions } from "./RepositoryActions.tsx";
import { SectionActions } from "./SectionActions.tsx";

import type { KeyboardEvent } from "react";

import type { RunsSnapshot } from "@fleetfrog/protocol/domain/activity";
import type { Fleet, Machine, Repository } from "@fleetfrog/protocol/domain/fleet";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";
import type { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

import type { ArrangedSection, Arrangement, ProjectSection } from "./projectLayout.ts";

export interface ProjectSelection {
  readonly repository: RepositoryKey;
  readonly machine: MachineId | null;
}

export type SelectionHistory = "Push" | "Replace";

export function selectionKey(selection: ProjectSelection): string {
  return `${selection.repository}|${selection.machine ?? ""}`;
}

export function findGridCell(selection: ProjectSelection): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-selection="${CSS.escape(selectionKey(selection))}"]`,
  );
}

function columnBackground(machine: Machine): string {
  return machine.connection._tag === "Offline" ? "bg-canvas" : "bg-surface";
}

const columnWidth = "w-52 min-w-full";

const nameColumnWidth = "min-w-60 max-w-sm";
const shrinkableName = "grid min-w-0 grid-cols-[minmax(0,max-content)]";

const cellHeight = "min-h-[3.375rem]";

const focusRing =
  "outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset";

const selectedRing =
  "aria-[current=true]:ring-2 aria-[current=true]:ring-accent aria-[current=true]:ring-inset";

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
      className={`sticky top-0 z-[3] border-b border-line p-0 text-center align-middle font-normal ${columnBackground(machine)}`}
    >
      <MachineActions
        fleet={fleet}
        machine={machine}
        trigger={{
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
  readonly position: string;
  readonly selected: boolean;
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

  const agentActivity =
    agent === undefined ? null : (
      <span
        className="mt-0.5 flex items-center justify-center gap-1 text-xs text-sync"
        title={`T3 Code: ${agent.title}`}
      >
        <BotIcon aria-hidden="true" className="size-3.5" />
        <span className="sr-only">T3 Code </span>
        {agent.state === "Waiting" ? "Waiting for you" : "Working"}
      </span>
    );

  const selection = { repository: repository.key, machine: machine.id };

  return (
    <td
      className={`h-px border-b border-line p-0 align-middle ${cell === null || cell.problem === null ? background : "bg-danger-soft"}`}
    >
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
                  agentActivity
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

function SectionIcon({ section }: { readonly section: ProjectSection }) {
  if (section._tag === "Pinned") {
    return <PinIcon aria-hidden="true" className="size-4 fill-current text-accent" />;
  }

  if (section._tag === "Group") {
    return <FolderIcon aria-hidden="true" className="size-4 text-ink-muted" />;
  }

  return section._tag === "Owner" ? (
    <HostIcon host={gitHost(section.identity)} className="text-ink-muted" />
  ) : null;
}

function StatusCounts({ repositories }: { readonly repositories: ReadonlyArray<Repository> }) {
  const count = (filter: "changes" | "out-of-sync") =>
    repositories.filter((repository) => repositoryMatches({ repository, filter, query: "" }))
      .length;

  const changes = count("changes");
  const outOfSync = count("out-of-sync");

  return (
    <span className="flex items-baseline gap-3 text-xs tabular-nums">
      {changes > 0 && (
        <span title={`${changes} with changes`}>
          <span aria-hidden="true" className="text-changes">
            ●
          </span>{" "}
          {changes}
          <span className="sr-only"> with changes</span>
        </span>
      )}
      {outOfSync > 0 && (
        <span title={`${outOfSync} out of sync`}>
          <span aria-hidden="true" className="text-sync">
            ↑↓
          </span>{" "}
          {outOfSync}
          <span className="sr-only"> out of sync</span>
        </span>
      )}
    </span>
  );
}

function SectionHeader({
  fleet,
  arranged,
  bodyId,
  live,
  searching,
}: {
  readonly fleet: Fleet;
  readonly arranged: ArrangedSection;
  readonly bodyId: string;
  readonly live: boolean;
  readonly searching: boolean;
}) {
  const { id, section, repositories, collapsed } = arranged;
  const title = sectionTitle(section);

  return (
    <tr>
      <th
        colSpan={fleet.machines.length + 1}
        scope="rowgroup"
        className="sticky top-[3.0625rem] z-[2] border-b border-line bg-canvas p-0 text-start font-normal"
      >
        <div className="sticky start-0 flex h-10 w-fit max-w-full items-center gap-2 ps-2 pe-4">
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            disabled={searching}
            title={searching ? "Sections stay open while you search" : undefined}
            onClick={() => {
              void changeProjectLayout((layout) => setCollapsed(layout, id, !collapsed));
            }}
            className={`flex min-w-0 items-center gap-2 rounded-md px-2 py-1 enabled:hover:bg-surface-raised ${focusRing}`}
          >
            <ChevronRightIcon
              aria-hidden="true"
              className={`size-4 shrink-0 text-ink-muted transition-transform duration-150 motion-reduce:transition-none ${collapsed ? "" : "rotate-90"}`}
            />
            <SectionIcon section={section} />
            <span className="truncate text-sm font-semibold" title={title}>
              {title}
            </span>
            <span className="rounded-full bg-chip px-1.5 text-xs leading-5 font-medium text-ink-muted tabular-nums">
              {repositories.length}
              <span className="sr-only"> repositories</span>
            </span>
          </button>
          <StatusCounts repositories={repositories} />
          {(repositories.length > 0 || section._tag === "Group") && (
            <span className="ms-1">
              <SectionActions
                fleet={fleet}
                section={section}
                repositories={repositories}
                live={live}
              />
            </span>
          )}
        </div>
      </th>
    </tr>
  );
}

function EmptyGroupRow({
  fleet,
  group,
}: {
  readonly fleet: Fleet;
  readonly group: Extract<ProjectSection, { _tag: "Group" }>["group"];
}) {
  const [editing, setEditing] = useState(false);

  return (
    <tr>
      <td colSpan={fleet.machines.length + 1} className="border-b border-line bg-surface p-0">
        <div className="sticky start-0 flex w-fit items-center gap-1 px-4 py-3 text-sm text-ink-muted">
          No repositories in this group yet.
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded px-1 font-medium text-accent-text hover:underline"
          >
            Add repositories
          </button>
        </div>
        {editing && (
          <GroupDialog
            repositories={fleet.repositories}
            group={group}
            onClose={() => setEditing(false)}
          />
        )}
      </td>
    </tr>
  );
}

function PinToggle({ repository }: { readonly repository: Repository }) {
  const { projects: layout } = usePreferences();
  const pinned = layout.pinned.includes(repository.key);

  return (
    <button
      type="button"
      aria-label={`Pin ${repository.label}`}
      aria-pressed={pinned}
      title={pinned ? "Unpin" : "Pin to top"}
      onClick={() => {
        void changeProjectLayout((previous) => setPinned(previous, repository.key, !pinned));
      }}
      className="grid size-8 shrink-0 place-items-center rounded-md text-ink-muted opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:bg-surface-raised hover:text-ink focus-visible:opacity-100 pointer-coarse:opacity-100"
    >
      <PinIcon aria-hidden="true" className={`size-4 ${pinned ? "fill-current" : ""}`} />
    </button>
  );
}

function RepositoryRow({
  fleet,
  repository,
  row,
  runs,
  selection,
  onSelect,
}: {
  readonly fleet: Fleet;
  readonly repository: Repository;
  readonly row: number;
  readonly runs: RunsSnapshot;
  readonly selection: ProjectSelection | null;
  readonly onSelect: (selection: ProjectSelection, history: SelectionHistory) => void;
}) {
  const rowSelection = { repository: repository.key, machine: null };
  const host = gitHost(repository.identity);

  const identity =
    repository.identity._tag === "Remote" ? `${host.name}: ${repository.identity.path}` : host.name;

  const rowSelected = selection?.repository === repository.key && selection.machine === null;

  return (
    <tr className="group/row">
      <th
        scope="row"
        className={`sticky start-0 z-[1] h-px border-e border-b border-line p-0 text-start align-middle font-medium ${rowSelected ? selectedRowBackground : "bg-surface"}`}
      >
        <div className={`flex h-full ${nameColumnWidth} items-center gap-0.5 pe-2`}>
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
                  <span className="truncate group-hover:underline">{repository.label}</span>
                </span>
              </>
            ) : (
              <span className="grid min-w-0 grid-cols-[1rem_minmax(0,max-content)] items-center gap-x-2 gap-y-0.5">
                <ProjectIcon icon={repository.icon} />
                <span className="truncate group-hover:underline">{repository.label}</span>
                <HostIcon host={host} className="size-3 justify-self-center text-ink-muted" />
                <span className="truncate text-xs font-normal text-ink-muted">
                  {repository.identity._tag === "Remote"
                    ? repository.identity.path
                    : repository.name}
                </span>
              </span>
            )}
          </button>
          <PinToggle repository={repository} />
          <RepositoryActions fleet={fleet} repository={repository} />
        </div>
      </th>
      {fleet.machines.map((machine, index) => (
        <MatrixCell
          key={machine.id}
          repository={repository}
          machine={machine}
          runs={runs}
          position={`${row}:${index + 1}`}
          selected={selection?.repository === repository.key && selection.machine === machine.id}
          rowSelected={rowSelected}
          onSelect={onSelect}
        />
      ))}
    </tr>
  );
}

function SectionBody({
  fleet,
  arranged,
  headed,
  firstRow,
  runs,
  live,
  searching,
  selection,
  onSelect,
}: {
  readonly fleet: Fleet;
  readonly arranged: ArrangedSection;
  readonly headed: boolean;
  readonly firstRow: number;
  readonly runs: RunsSnapshot;
  readonly live: boolean;
  readonly searching: boolean;
  readonly selection: ProjectSelection | null;
  readonly onSelect: (selection: ProjectSelection, history: SelectionHistory) => void;
}) {
  const bodyId = useId();
  const { section, repositories, collapsed } = arranged;

  return (
    <tbody id={bodyId}>
      {headed && (
        <SectionHeader
          fleet={fleet}
          arranged={arranged}
          bodyId={bodyId}
          live={live}
          searching={searching}
        />
      )}
      {!collapsed && section._tag === "Group" && repositories.length === 0 && (
        <EmptyGroupRow fleet={fleet} group={section.group} />
      )}
      {!collapsed &&
        repositories.map((repository, index) => (
          <RepositoryRow
            key={repository.key}
            fleet={fleet}
            repository={repository}
            row={firstRow + index}
            runs={runs}
            selection={selection}
            onSelect={onSelect}
          />
        ))}
    </tbody>
  );
}

export function ProjectGrid({
  fleet,
  arrangement,
  live,
  searching,
  selection,
  onSelect,
}: {
  readonly fleet: Fleet;
  readonly arrangement: Arrangement;
  readonly live: boolean;
  readonly searching: boolean;
  readonly selection: ProjectSelection | null;
  readonly onSelect: (selection: ProjectSelection, history: SelectionHistory) => void;
}) {
  const runs = useRuns();
  const { machines } = fleet;
  const rows = visibleRows(arrangement);

  const firstRows = arrangement.sections.reduce<ReadonlyArray<number>>(
    (starts, { repositories, collapsed }, index) => [
      ...starts,
      (starts[index] ?? 0) + (collapsed ? 0 : repositories.length),
    ],
    [0],
  );

  const moveFocus = (event: KeyboardEvent<HTMLTableElement>) => {
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

    const repository = rows[nextRow];

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
    <div
      className={`relative min-h-0 w-full max-w-projects scroll-ps-[min(24rem,40%)] overflow-auto rounded-lg border border-line bg-surface ${arrangement.headed ? "scroll-pt-[5.625rem]" : "scroll-pt-[3.0625rem]"}`}
    >
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Arrow keys move focus between the grid buttons inside the table. */}
      <table className="w-full border-separate border-spacing-0 text-sm" onKeyDown={moveFocus}>
        <caption className="sr-only">
          Repositories by machine. Choose a repository or a cell to see its details.
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky start-0 top-0 z-[4] w-sm border-e border-b border-line bg-surface px-4 py-2 text-start align-middle font-semibold"
            >
              Repository
            </th>
            {machines.map((machine) => (
              <MachineHeader key={machine.id} fleet={fleet} machine={machine} />
            ))}
          </tr>
        </thead>
        {arrangement.sections.map((arranged, index) => (
          <SectionBody
            key={arranged.id}
            fleet={fleet}
            arranged={arranged}
            headed={arrangement.headed}
            firstRow={firstRows[index] ?? 0}
            runs={runs}
            live={live}
            searching={searching}
            selection={selection}
            onSelect={onSelect}
          />
        ))}
      </table>
    </div>
  );
}
