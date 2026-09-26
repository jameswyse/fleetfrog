import { ChevronLeftIcon, FolderGit2Icon, GitForkIcon } from "lucide-react";

import { MachineKindIcon } from "@/ui/MachineKindIcon.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { machineKind, machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { CellState } from "../CellContent.tsx";
import { summariseCell } from "../cellSummary.ts";
import { CheckoutActions } from "./CheckoutActions.tsx";
import { CheckoutSections } from "./CheckoutSections.tsx";
import { PanelHeader } from "./PanelHeader.tsx";

import type { Machine, MachineCheckout, Repository } from "@fleetfrog/protocol/domain/fleet";

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
    <nav aria-label="Checkouts on this machine" className="border-t border-line px-3 py-2">
      <ul className="space-y-0.5">
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
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-start text-sm hover:bg-surface-raised aria-[current=true]:bg-surface-raised"
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
    </nav>
  );
}

/** One repository on one machine: its checkouts, then everything about the chosen one. */
export function CellPanel({
  repository,
  machine,
  path,
  headingId,
  onSelect,
  onChoosePath,
  onClose,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
  /** The checkout to show, when the machine has several. */
  readonly path: string | null;
  readonly headingId: string;
  readonly onSelect: (selection: ProjectSelection, history: SelectionHistory) => void;
  readonly onChoosePath: (path: string) => void;
  readonly onClose: () => void;
}) {
  const cell = summariseCell(
    repository.checkouts.filter(({ machineId }) => machineId === machine.id),
  );
  const entry = cell?.entries.find(({ checkout }) => checkout.path === path) ?? cell?.primary;
  const offline = machine.connection._tag === "Offline";

  return (
    <>
      <PanelHeader
        headingId={headingId}
        title={repository.name}
        back={
          <button
            type="button"
            onClick={() => onSelect({ repository: repository.key, machine: null }, "Push")}
            className="-ms-1.5 mb-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm text-ink-muted hover:bg-surface-raised hover:text-ink"
          >
            <ChevronLeftIcon />
            Every machine
          </button>
        }
        subtitle={
          <span className="flex items-center gap-1.5">
            <MachineKindIcon kind={machineKind(machine)} />
            {machineLabel(machine)}
            {offline && " · offline, showing the last scan"}
          </span>
        }
        onClose={onClose}
      />
      {cell === null || entry === undefined ? (
        <p className="border-t border-line px-5 py-4 text-sm text-ink-muted">
          {repository.name} isn't on {machineLabel(machine)}.
        </p>
      ) : (
        <>
          {cell.entries.length > 1 && (
            <CheckoutPicker entries={cell.entries} current={entry} onChoose={onChoosePath} />
          )}
          <div className="space-y-3 border-t border-line px-5 py-4">
            <div>
              <p className="font-mono text-xs break-all text-ink-muted">{entry.checkout.path}</p>
              {entry.checkout.worktree._tag === "Linked" && (
                <p className="mt-1 text-xs text-ink-muted">
                  Worktree of{" "}
                  <span className="font-mono break-all">{entry.checkout.worktree.mainPath}</span>
                </p>
              )}
              <p className="mt-1 text-xs text-ink-muted">
                Scanned <RelativeTime at={entry.checkout.scannedAt} />
                {entry.checkout.status._tag === "Read" && (
                  <>
                    {" · "}
                    {entry.checkout.status.git.lastFetchedAt === null ? (
                      "never fetched"
                    ) : (
                      <>
                        fetched <RelativeTime at={entry.checkout.status.git.lastFetchedAt} />
                      </>
                    )}
                  </>
                )}
              </p>
            </div>
            <CheckoutActions machine={machine} checkout={entry.checkout} />
          </div>
          <CheckoutSections repository={repository} machine={machine} checkout={entry.checkout} />
        </>
      )}
    </>
  );
}
