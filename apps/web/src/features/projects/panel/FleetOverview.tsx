import { Link } from "@tanstack/react-router";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CircleCheckIcon,
  FilePenIcon,
  GitPullRequestIcon,
  MonitorIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { MachineKindIcon } from "@/ui/MachineKindIcon.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { machineKind, machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { Glyph, plural, problemWords } from "../CellContent.tsx";
import { latestGithub, summariseCell } from "../cellSummary.ts";
import { PanelHeader } from "./PanelHeader.tsx";
import { PanelSection, ShortList } from "./PanelSection.tsx";

import type { ReactNode } from "react";

import type { Fleet, Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

import type { CellSummary } from "../cellSummary.ts";
import type { ProjectSelection, SelectionHistory } from "../ProjectGrid.tsx";

/** A repository on one machine, with what its cell in the grid shows. */
interface FleetCell {
  readonly repository: Repository;
  readonly machine: Machine;
  readonly cell: CellSummary;
}

function fleetCells(fleet: Fleet): ReadonlyArray<FleetCell> {
  return fleet.repositories.flatMap((repository) =>
    fleet.machines.flatMap((machine) => {
      const cell = summariseCell(
        repository.checkouts.filter(({ machineId }) => machineId === machine.id),
      );

      return cell === null ? [] : [{ repository, machine, cell }];
    }),
  );
}

const listClassName = "-mx-1.5 space-y-0.5";

/** A cell in one line: the repository, its machine and a symbol, opening the cell when chosen. */
function CellRow({
  item,
  onSelect,
  children,
}: {
  readonly item: FleetCell;
  readonly onSelect: (selection: ProjectSelection, history: SelectionHistory) => void;
  /** The symbol and count, or a short note, at the end of the line. */
  readonly children: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() =>
          onSelect({ repository: item.repository.key, machine: item.machine.id }, "Push")
        }
        className="flex w-full items-center gap-3 rounded-lg px-1.5 py-1 text-start text-sm hover:bg-canvas"
      >
        <span className="min-w-0 flex-1 truncate font-medium">{item.repository.name}</span>
        <span className="flex max-w-[35%] shrink-0 items-center gap-1.5 text-xs text-ink-muted">
          <MachineKindIcon kind={machineKind(item.machine)} />
          <span className="truncate">{machineLabel(item.machine)}</span>
        </span>
        <span className="shrink-0 text-xs font-medium tabular-nums">{children}</span>
      </button>
    </li>
  );
}

function MachineRow({ fleet, machine }: { readonly fleet: Fleet; readonly machine: Machine }) {
  const { connection } = machine;
  const online = connection._tag === "Online";
  const repositories = fleet.repositories.filter(({ checkouts }) =>
    checkouts.some(({ machineId }) => machineId === machine.id),
  ).length;

  return (
    <li>
      <Link
        to="/settings/fleet/$machineId"
        params={{ machineId: machine.id }}
        className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm hover:bg-canvas"
      >
        <span
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-full ${online ? "bg-clean" : "bg-ink-muted"}`}
        />
        <MachineKindIcon kind={machineKind(machine)} className="text-ink-muted" />
        <span className="min-w-0 flex-1 truncate font-medium">{machineLabel(machine)}</span>
        <span className="shrink-0 text-xs text-ink-muted">
          {connection._tag === "Online" && (
            <>
              <span className="sr-only">Online, </span>
              {plural(repositories, "repository", "repositories")}
              {machine.lastDiscoveryAt !== null && (
                <>
                  {" · scanned "}
                  <RelativeTime at={machine.lastDiscoveryAt} />
                </>
              )}
            </>
          )}
          {connection._tag === "Offline" && (
            <>
              Offline
              {connection.lastSeenAt !== null && (
                <>
                  {" · seen "}
                  <RelativeTime at={connection.lastSeenAt} />
                </>
              )}
            </>
          )}
        </span>
      </Link>
    </li>
  );
}

/**
 * What the panel shows when nothing is chosen: the machines, then every cell that needs something
 * done, grouped the way the grid's symbols are.
 */
export function FleetOverview({
  fleet,
  headingId,
  onSelect,
}: {
  readonly fleet: Fleet;
  readonly headingId: string;
  readonly onSelect: (selection: ProjectSelection, history: SelectionHistory) => void;
}) {
  const { machines, repositories } = fleet;
  const cells = fleetCells(fleet);
  const problems = cells.filter(({ cell }) => cell.problem !== null);
  const changed = cells
    .filter(({ cell }) => cell.changes > 0)
    .toSorted((left, right) => right.cell.changes - left.cell.changes);
  const toPush = cells
    .filter(({ cell }) => cell.ahead > 0)
    .toSorted((left, right) => right.cell.ahead - left.cell.ahead);
  const toPull = cells
    .filter(({ cell }) => cell.behind > 0 || cell.remoteMoved)
    .toSorted((left, right) => right.cell.behind - left.cell.behind);
  const pullRequests = repositories.flatMap((repository) =>
    (latestGithub(repository)?.pullRequests ?? []).map((pull) => ({ repository, pull })),
  );
  const online = machines.filter(({ connection }) => connection._tag === "Online").length;
  const settled = problems.length + changed.length + toPush.length + toPull.length === 0;

  return (
    <>
      <PanelHeader
        headingId={headingId}
        title="Fleet"
        subtitle={`${plural(repositories.length, "repository", "repositories")} on ${plural(machines.length, "machine")}`}
      />
      <div className="space-y-3 px-4 pb-6">
        <PanelSection
          title="Machines"
          icon={MonitorIcon}
          tone="neutral"
          count={`${online} of ${machines.length} online`}
        >
          <ul className={listClassName}>
            {machines.map((machine) => (
              <MachineRow key={machine.id} fleet={fleet} machine={machine} />
            ))}
          </ul>
        </PanelSection>
        {settled && (
          <p className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2.5 text-sm">
            <CircleCheckIcon className="text-clean" />
            Everything is committed and up to date.
          </p>
        )}
        {problems.length > 0 && (
          <PanelSection
            title="Problems"
            icon={TriangleAlertIcon}
            tone="danger"
            count={problems.length}
          >
            <ShortList
              items={problems}
              total={problems.length}
              noun="problems"
              listClassName={listClassName}
              render={(item) => (
                <CellRow
                  key={`${item.repository.key}|${item.machine.id}`}
                  item={item}
                  onSelect={onSelect}
                >
                  <span className="font-normal text-danger">
                    {item.cell.problem === null ? null : problemWords[item.cell.problem]}
                  </span>
                </CellRow>
              )}
            />
          </PanelSection>
        )}
        {changed.length > 0 && (
          <PanelSection
            title="Uncommitted changes"
            icon={FilePenIcon}
            tone="changes"
            count={changed.length}
          >
            <ShortList
              items={changed}
              total={changed.length}
              noun="repositories"
              listClassName={listClassName}
              render={(item) => (
                <CellRow
                  key={`${item.repository.key}|${item.machine.id}`}
                  item={item}
                  onSelect={onSelect}
                >
                  <Glyph
                    className="text-changes"
                    symbol={`●${item.cell.changes}`}
                    meaning={plural(item.cell.changes, "changed file")}
                  />
                </CellRow>
              )}
            />
          </PanelSection>
        )}
        {toPush.length > 0 && (
          <PanelSection title="To push" icon={ArrowUpIcon} tone="sync" count={toPush.length}>
            <ShortList
              items={toPush}
              total={toPush.length}
              noun="repositories"
              listClassName={listClassName}
              render={(item) => (
                <CellRow
                  key={`${item.repository.key}|${item.machine.id}`}
                  item={item}
                  onSelect={onSelect}
                >
                  <Glyph
                    className="text-sync"
                    symbol={`↑${item.cell.ahead}`}
                    meaning={`${plural(item.cell.ahead, "commit")} to push`}
                  />
                </CellRow>
              )}
            />
          </PanelSection>
        )}
        {toPull.length > 0 && (
          <PanelSection title="To pull" icon={ArrowDownIcon} tone="sync" count={toPull.length}>
            <ShortList
              items={toPull}
              total={toPull.length}
              noun="repositories"
              listClassName={listClassName}
              render={(item) => (
                <CellRow
                  key={`${item.repository.key}|${item.machine.id}`}
                  item={item}
                  onSelect={onSelect}
                >
                  {item.cell.behind > 0 ? (
                    <Glyph
                      className="text-sync"
                      symbol={`↓${item.cell.behind}`}
                      meaning={`${plural(item.cell.behind, "commit")} to pull`}
                    />
                  ) : (
                    <Glyph
                      className="text-sync"
                      symbol="↓"
                      meaning="New commits on GitHub, not fetched yet"
                    />
                  )}
                </CellRow>
              )}
            />
          </PanelSection>
        )}
        {pullRequests.length > 0 && (
          <PanelSection
            title="Pull requests"
            icon={GitPullRequestIcon}
            tone="neutral"
            count={pullRequests.length}
          >
            <ShortList
              items={pullRequests}
              total={pullRequests.length}
              noun="pull requests"
              listClassName={listClassName}
              render={({ repository, pull }) => (
                <li key={`${repository.key}#${pull.number}`}>
                  <a
                    href={pull.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-baseline gap-2 rounded-lg px-1.5 py-1 text-sm hover:bg-canvas"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-sync">#{pull.number}</span> {pull.title}
                      {pull.draft && <span className="text-ink-muted"> · draft</span>}
                    </span>
                    <span className="max-w-[40%] shrink-0 truncate text-xs text-ink-muted">
                      {repository.name}
                    </span>
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </li>
              )}
            />
          </PanelSection>
        )}
      </div>
    </>
  );
}
