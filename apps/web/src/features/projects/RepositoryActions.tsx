import { useState } from "react";

import {
  ArrowDownToLineIcon,
  CheckIcon,
  CloudDownloadIcon,
  FolderDownIcon,
  FolderPlusIcon,
  PinIcon,
  PinOffIcon,
} from "lucide-react";

import { Menu, MenuItem } from "@/ui/Menu.tsx";

import { canFetch, canPull, cloneBlocker } from "../actions/actionAvailability.ts";
import { CloneDialog } from "../actions/CloneDialog.tsx";
import { PullDialog } from "../actions/PullDialog.tsx";
import { useStartBatch } from "../actions/useStartBatch.ts";
import { GroupDialog } from "./GroupDialog.tsx";
import { moveToGroup, setPinned } from "./layoutChanges.ts";
import { groupOf } from "./projectLayout.ts";
import { changeProjectLayout, useProjectLayout } from "./projectLayoutStore.ts";

import type { Fleet, Repository } from "@fleetfrog/protocol/domain/fleet";

export function RepositoryActions({
  fleet,
  repository,
}: {
  readonly fleet: Fleet;
  readonly repository: Repository;
}) {
  const [dialog, setDialog] = useState<"pull" | "clone" | "group" | null>(null);
  const { start, pending, failure } = useStartBatch();
  const layout = useProjectLayout();
  const pinned = layout.pinned.includes(repository.key);
  const current = groupOf(layout, repository);

  const holders = new Set(repository.checkouts.map(({ machineId }) => machineId));

  const canClone = fleet.machines.some(
    (machine) => !holders.has(machine.id) && cloneBlocker(machine) === null,
  );

  const scope = { _tag: "Repository", repositoryKey: repository.key } as const;

  return (
    <>
      <Menu label={`Actions for ${repository.label}`}>
        {(close) => (
          <>
            <MenuItem
              icon={<CloudDownloadIcon />}
              disabled={!canFetch(fleet, [repository]) || pending}
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
            <div className="my-1 border-t border-line" />
            <MenuItem
              icon={pinned ? <PinOffIcon /> : <PinIcon />}
              onClick={() => {
                close();
                void changeProjectLayout((previous) =>
                  setPinned(previous, repository.key, !pinned),
                );
              }}
            >
              {pinned ? "Unpin" : "Pin to top"}
            </MenuItem>
            <div className="my-1 border-t border-line" />
            <p className="px-3 pt-1 pb-0.5 text-xs font-medium text-ink-muted">Group</p>
            <div className="max-h-56 overflow-auto">
              {layout.groups.map((group) => {
                const member = group.id === current?.id;

                return (
                  <MenuItem
                    key={group.id}
                    icon={<CheckIcon className={member ? "text-accent" : "invisible"} />}
                    aria-pressed={member}
                    onClick={() => {
                      close();
                      void changeProjectLayout((previous) =>
                        moveToGroup(previous, repository.key, member ? null : group.id),
                      );
                    }}
                  >
                    <span className="truncate">{group.name}</span>
                  </MenuItem>
                );
              })}
            </div>
            <MenuItem
              icon={<FolderPlusIcon />}
              onClick={() => {
                close();
                setDialog("group");
              }}
            >
              New group…
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
      {dialog === "group" && (
        <GroupDialog
          repositories={fleet.repositories}
          group={null}
          initialMembers={[repository.key]}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
