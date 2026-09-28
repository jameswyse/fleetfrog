import { FolderGit2Icon, GitForkIcon, LayersIcon, TriangleAlertIcon } from "lucide-react";

import { MachineKindIcon } from "@/ui/MachineKindIcon.tsx";
import { ProjectIcon } from "@/ui/ProjectIcon.tsx";
import { machineKind, machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { CellState, problemWords } from "../CellContent.tsx";
import { cellFor, summariseCell } from "../cellSummary.ts";
import { RepositoryActions } from "../RepositoryActions.tsx";
import { CheckoutSections } from "./CheckoutSections.tsx";
import { CloneSections } from "./CloneSections.tsx";
import { FocusHeading } from "./FocusHeading.tsx";
import { Crumb, PanelHeader } from "./PanelHeader.tsx";
import { PanelSection } from "./PanelSection.tsx";
import { RepositoryLink } from "./RepositoryLink.tsx";

import type { Fleet, Machine, MachineCheckout, Repository } from "@fleetfrog/protocol/domain/fleet";

import type { ProjectSelection, SelectionHistory } from "../ProjectGrid.tsx";

/** The last part of a path: a checkout's own folder, which tells worktrees apart. */
function folderName(path: string): string {
  return path.split("/").findLast((part) => part !== "") ?? path;
}

/** Every checkout of the repository on this machine, each with its branch and state. */
function CheckoutPicker({
  entries,
  current,
  onChoose,
}: {
  readonly entries: ReadonlyArray<MachineCheckout>;
  readonly current: MachineCheckout;
  readonly onChoose: (path: string) => void;
}) {
  return (
    <PanelSection
      title="Checkouts on this machine"
      icon={LayersIcon}
      tone="neutral"
      count={entries.length}
    >
      <ul className="-mx-1.5 space-y-0.5">
        {entries.map((entry) => {
          const single = summariseCell([entry]);
          const linked = entry.checkout.worktree._tag === "Linked";

          return (
            <li key={entry.checkout.path}>
              <button
                type="button"
                aria-current={entry === current ? "true" : undefined}
                onClick={() => onChoose(entry.checkout.path)}
                title={entry.checkout.path}
                className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-start text-sm hover:bg-canvas aria-[current=true]:bg-accent-soft"
              >
                {linked ? (
                  <GitForkIcon className="text-ink-muted" />
                ) : (
                  <FolderGit2Icon className="text-ink-muted" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {folderName(entry.checkout.path)}
                  </span>
                  <span className="block truncate text-xs text-ink-muted">
                    <span className="font-mono">{single?.branch ?? "Unreadable"}</span>
                    {linked ? " · worktree" : " · clone"}
                  </span>
                </span>
                {single !== null && (
                  <span className="flex shrink-0 items-baseline gap-1.5 text-xs font-medium tabular-nums">
                    <CellState cell={single} />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </PanelSection>
  );
}

/**
 * One repository on one machine: its checkouts, then everything about the chosen one, or its clone
 * when the machine doesn't have it.
 */
export function CellPanel({
  fleet,
  repository,
  machine,
  path,
  headingId,
  onSelect,
  onChoosePath,
  onClose,
}: {
  readonly fleet: Fleet;
  readonly repository: Repository;
  readonly machine: Machine;
  /** The checkout to show, when the machine has several. */
  readonly path: string | null;
  readonly headingId: string;
  readonly onSelect: (selection: ProjectSelection, history: SelectionHistory) => void;
  readonly onChoosePath: (path: string) => void;
  readonly onClose: () => void;
}) {
  const cell = cellFor(repository, machine.id);
  const entry = cell?.entries.find(({ checkout }) => checkout.path === path) ?? cell?.primary;
  const offline = machine.connection._tag === "Offline";

  return (
    <>
      <PanelHeader
        headingId={headingId}
        title={
          <>
            <Crumb>
              {/* The repository on every machine, where "Every machine" used to lead. */}
              <button
                type="button"
                onClick={() => onSelect({ repository: repository.key, machine: null }, "Push")}
                title="Show it on every machine"
                className="flex min-w-0 items-center gap-1.5 rounded underline-offset-2 hover:text-ink hover:underline"
              >
                {repository.icon !== null && <ProjectIcon icon={repository.icon} />}
                <span className="truncate">{repository.label}</span>
              </button>
            </Crumb>
            <Crumb last>
              <MachineKindIcon kind={machineKind(machine)} />
              <span className="truncate">{machineLabel(machine)}</span>
              {offline && <span className="font-normal text-ink-muted">(offline)</span>}
            </Crumb>
          </>
        }
        subtitle={<RepositoryLink identity={repository.identity} />}
        actions={<RepositoryActions fleet={fleet} repository={repository} />}
        onClose={onClose}
      />
      {/* A finished clone swaps the clone form for the checkout, taking focus with it. */}
      <FocusHeading key={cell === null ? "missing" : "present"} targetId={headingId} />
      {cell === null || entry === undefined ? (
        <div className="space-y-3 px-4 pb-6">
          <CloneSections fleet={fleet} repository={repository} machine={machine} />
        </div>
      ) : (
        <div className="space-y-3 px-4 pb-6">
          {cell.entries
            .filter((other) => other !== entry)
            .flatMap((other) => {
              const problem = summariseCell([other])?.problem ?? null;

              return problem === null ? [] : [{ other, problem }];
            })
            .map(({ other, problem }) => (
              // The grid shows the cell in red for a problem in any checkout, so say which.
              <div
                key={other.checkout.path}
                className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger"
              >
                <TriangleAlertIcon className="mt-0.5" />
                <p className="min-w-0 flex-1">
                  <span className="font-medium">{folderName(other.checkout.path)}</span>:{" "}
                  {problemWords[problem]}
                </p>
                <button
                  type="button"
                  onClick={() => onChoosePath(other.checkout.path)}
                  className="shrink-0 underline-offset-2 hover:underline"
                >
                  Show it
                </button>
              </div>
            ))}
          {cell.entries.length > 1 && (
            <CheckoutPicker entries={cell.entries} current={entry} onChoose={onChoosePath} />
          )}
          <CheckoutSections repository={repository} machine={machine} checkout={entry.checkout} />
        </div>
      )}
    </>
  );
}
