import { useState } from "react";

import { ArrowDownToLineIcon, CloudDownloadIcon, FolderDownIcon } from "lucide-react";

import { Menu, MenuItem } from "@/ui/Menu.tsx";

import { canPull, cloneBlocker, machineBlocker } from "../actions/actionAvailability.ts";
import { CloneDialog } from "../actions/CloneDialog.tsx";
import { PullDialog } from "../actions/PullDialog.tsx";
import { useStartBatch } from "../actions/useStartBatch.ts";

import type { Fleet, Repository } from "@fleetfrog/protocol/domain/fleet";

/** A repository row's menu: fetch or pull it everywhere, or clone it onto another machine. */
export function RepositoryActions({
  fleet,
  repository,
}: {
  readonly fleet: Fleet;
  readonly repository: Repository;
}) {
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
  const scope = { _tag: "Repository", repositoryKey: repository.key } as const;

  return (
    <>
      <Menu label={`Actions for ${repository.name}`}>
        {(close) => (
          <>
            <MenuItem
              icon={<CloudDownloadIcon />}
              disabled={!canFetch || pending}
              onClick={() => start({ _tag: "Fetch", scope }, close)}
            >
              {pending ? "Starting…" : "Fetch on every machine"}
            </MenuItem>
            <MenuItem
              icon={<ArrowDownToLineIcon />}
              disabled={!canPull(fleet, scope)}
              onClick={() => {
                close();
                setDialog("pull");
              }}
            >
              Pull on every machine
            </MenuItem>
            <MenuItem
              icon={<FolderDownIcon />}
              disabled={!canClone}
              onClick={() => {
                close();
                setDialog("clone");
              }}
            >
              Clone to another machine
            </MenuItem>
            <p role="status" className="px-3 text-sm text-danger">
              {failure}
            </p>
          </>
        )}
      </Menu>
      {dialog === "pull" && (
        <PullDialog fleet={fleet} scope={scope} onClose={() => setDialog(null)} />
      )}
      {dialog === "clone" && (
        <CloneDialog fleet={fleet} repository={repository} onClose={() => setDialog(null)} />
      )}
    </>
  );
}
