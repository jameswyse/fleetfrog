import { useId, useRef, useState } from "react";

import { canPull, cloneBlocker, machineBlocker } from "../actions/actionAvailability.ts";
import { CloneDialog } from "../actions/CloneDialog.tsx";
import { PullDialog } from "../actions/PullDialog.tsx";
import { useStartBatch } from "../actions/useStartBatch.ts";

import type { Fleet, Repository } from "@fleetfrog/protocol/domain/fleet";

const itemClass =
  "block w-full rounded px-3 py-2 text-start text-sm hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60";

/** A repository row's menu: fetch or pull it everywhere, or clone it onto another machine. */
export function RepositoryActions({
  fleet,
  repository,
}: {
  readonly fleet: Fleet;
  readonly repository: Repository;
}) {
  const menuId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [dialog, setDialog] = useState<"pull" | "clone" | null>(null);
  const { start, pending, failure } = useStartBatch();
  const machines = new Map(fleet.machines.map((machine) => [machine.id, machine]));
  const canFetch = repository.checkouts.some(({ machineId }) => {
    const machine = machines.get(machineId);

    return machine !== undefined && machineBlocker(machine, "Fetch") === null;
  });
  const holders = new Set(repository.checkouts.map(({ machineId }) => machineId));
  const canClone = fleet.machines.some(
    (machine) => !holders.has(machine.id) && cloneBlocker(machine) === null,
  );

  const openDialog = (next: "pull" | "clone") => {
    menu.current?.hidePopover();
    setDialog(next);
  };

  return (
    <>
      <button
        type="button"
        popoverTarget={menuId}
        aria-label={`Actions for ${repository.name}`}
        className="-me-2 grid size-8 shrink-0 place-items-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-ink"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="currentColor">
          <circle cx="3" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>
      <div
        ref={menu}
        id={menuId}
        popover="auto"
        className="w-64 rounded-lg border border-line bg-surface p-1 text-ink shadow-xl supports-[position-area:bottom]:inset-auto supports-[position-area:bottom]:m-0 supports-[position-area:bottom]:[position-area:bottom_span-left] supports-[position-area:bottom]:[position-try-fallbacks:flip-block]"
      >
        <button
          type="button"
          disabled={!canFetch || pending}
          onClick={() =>
            start(
              { _tag: "Fetch", scope: { _tag: "Repository", repositoryKey: repository.key } },
              () => menu.current?.hidePopover(),
            )
          }
          className={itemClass}
        >
          {pending ? "Starting…" : "Fetch on every machine"}
        </button>
        <button
          type="button"
          disabled={!canPull(fleet, { _tag: "Repository", repositoryKey: repository.key })}
          onClick={() => openDialog("pull")}
          className={itemClass}
        >
          Pull on every machine…
        </button>
        <button
          type="button"
          disabled={!canClone}
          onClick={() => openDialog("clone")}
          className={itemClass}
        >
          Clone to another machine…
        </button>
        <p role="status" className="px-3 text-sm text-danger">
          {failure}
        </p>
      </div>
      {dialog === "pull" && (
        <PullDialog
          fleet={fleet}
          scope={{ _tag: "Repository", repositoryKey: repository.key }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "clone" && (
        <CloneDialog fleet={fleet} repository={repository} onClose={() => setDialog(null)} />
      )}
    </>
  );
}
