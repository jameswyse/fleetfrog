import { useState, useTransition } from "react";

import {
  ArrowDownIcon,
  ArrowDownToLineIcon,
  ArrowUpIcon,
  CloudDownloadIcon,
  FolderDownIcon,
  FolderSearchIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";

import { requestHub } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { Menu, MenuItem } from "@/ui/Menu.tsx";
import { plural } from "@/ui/plural.ts";
import { maximumGroupNameLength } from "@fleetfrog/protocol/domain/activity";
import { cloneSource } from "@fleetfrog/protocol/domain/cloneDestination";

import { canFetch, canPull, cloneBlocker } from "../actions/actionAvailability.ts";
import { PullDialog } from "../actions/PullDialog.tsx";
import { useStartBatch } from "../actions/useStartBatch.ts";
import { changeProjectLayout, usePreferences } from "../preferences/preferences.ts";
import { GroupCloneDialog } from "./GroupCloneDialog.tsx";
import { GroupDialog } from "./GroupDialog.tsx";
import { deleteGroup, moveGroup } from "./layoutChanges.ts";
import { sectionTitle } from "./projectLayout.ts";

import type { Fleet, Repository } from "@fleetfrog/protocol/domain/fleet";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";
import type { ProjectGroup } from "@fleetfrog/protocol/domain/preferences";

import type { ProjectSection } from "./projectLayout.ts";

function DeleteGroupDialog({
  group,
  onClose,
}: {
  readonly group: ProjectGroup;
  readonly onClose: () => void;
}) {
  const { projects: layout } = usePreferences();
  const [failure, setFailure] = useState<string | null>(null);
  const [deleting, startDeleting] = useTransition();
  const destination = layout.groupByOwner ? "their owners' sections" : "Ungrouped";

  return (
    <Dialog title={`Delete the ${group.name} group?`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p>
          {group.repositories.length === 0
            ? "The group is empty, so nothing else changes."
            : `Its ${plural(group.repositories.length, "repository", "repositories")} move to ${destination}. Nothing changes on your machines.`}
        </p>
        <p role="status" className="text-danger">
          {failure}
        </p>
        <div className="flex justify-end gap-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            tone="danger"
            disabled={deleting}
            onClick={() =>
              startDeleting(async () => {
                const result = await changeProjectLayout((current) =>
                  deleteGroup(current, group.id),
                );

                if (result._tag === "Failure") {
                  setFailure(`Couldn't delete the group. ${result.message}`);
                } else {
                  onClose();
                }
              })
            }
          >
            {deleting ? "Deleting…" : "Delete group"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

type SectionDialog = "pull" | "clone" | "edit" | "delete";

export function SectionActions({
  fleet,
  section,
  repositories,
  live,
}: {
  readonly fleet: Fleet;
  readonly section: ProjectSection;
  readonly repositories: ReadonlyArray<Repository>;
  readonly live: boolean;
}) {
  const { projects: layout } = usePreferences();
  const [dialog, setDialog] = useState<SectionDialog | null>(null);
  const fetching = useStartBatch();
  const [rescanning, startRescan] = useTransition();
  const [rescanFailure, setRescanFailure] = useState<string | null>(null);
  const title = sectionTitle(section);
  const group = section._tag === "Group" ? section.group : null;
  const groupIndex = group === null ? -1 : layout.groups.findIndex(({ id }) => id === group.id);
  const machines = new Map(fleet.machines.map((machine) => [machine.id, machine]));
  const [first, ...others] = repositories.map(({ key }) => key);

  const scope =
    first === undefined
      ? null
      : ({
          _tag: "Repositories",
          groupName: title.slice(0, maximumGroupNameLength),
          repositoryKeys: [first, ...others],
        } as const);

  const holders: ReadonlyArray<MachineId> = [
    ...new Set(
      repositories.flatMap(({ checkouts }) => checkouts.map(({ machineId }) => machineId)),
    ),
  ];

  const canClone = fleet.machines.some(
    (machine) =>
      cloneBlocker(machine) === null &&
      repositories.some(
        (repository) =>
          cloneSource(repository) !== undefined &&
          !repository.checkouts.some(({ machineId }) => machineId === machine.id),
      ),
  );

  const online = holders.filter(
    (machineId) => machines.get(machineId)?.connection._tag === "Online",
  );

  const count = plural(repositories.length, "repository", "repositories");

  const failure =
    fetching.failure === null ? rescanFailure : `Couldn't start the fetch. ${fetching.failure}`;

  const open = (next: SectionDialog, close: () => void) => {
    close();
    setDialog(next);
  };

  return (
    <>
      <Menu label={`Actions for ${title}`}>
        {(close) => (
          <>
            {repositories.length > 0 && (
              <>
                <MenuItem
                  icon={<CloudDownloadIcon />}
                  disabled={
                    !live || scope === null || !canFetch(fleet, repositories) || fetching.pending
                  }
                  onClick={() => {
                    if (scope !== null) {
                      fetching.start({ _tag: "Fetch", scope }, close);
                    }
                  }}
                >
                  {fetching.pending ? "Starting…" : `Fetch ${count}`}
                </MenuItem>
                <MenuItem
                  icon={<ArrowDownToLineIcon />}
                  disabled={!live || scope === null || !canPull(fleet, scope)}
                  onClick={() => open("pull", close)}
                >
                  Pull {count}…
                </MenuItem>
                <MenuItem
                  icon={<FolderDownIcon />}
                  disabled={!live || !canClone}
                  onClick={() => open("clone", close)}
                >
                  Clone to a machine…
                </MenuItem>
                <MenuItem
                  icon={<FolderSearchIcon />}
                  disabled={!live || online.length === 0 || rescanning}
                  onClick={() =>
                    startRescan(async () => {
                      const [head, ...rest] = online;

                      if (head === undefined) {
                        return;
                      }

                      const result = await requestHub((client) =>
                        client.Refresh({
                          target: { _tag: "Machines", machineIds: [head, ...rest] },
                        }),
                      );

                      if (result._tag === "Failure") {
                        setRescanFailure(`Couldn't start a rescan. ${result.message}`);
                      } else {
                        setRescanFailure(null);
                        close();
                      }
                    })
                  }
                >
                  {rescanning ? "Requesting rescan…" : `Rescan ${plural(online.length, "machine")}`}
                </MenuItem>
              </>
            )}
            {group !== null && (
              <>
                {repositories.length > 0 && <div className="my-1 border-t border-line" />}
                <MenuItem icon={<PencilIcon />} onClick={() => open("edit", close)}>
                  Edit group…
                </MenuItem>
                <MenuItem
                  icon={<ArrowUpIcon />}
                  disabled={groupIndex <= 0}
                  onClick={() => {
                    void changeProjectLayout((current) => moveGroup(current, group.id, -1));
                  }}
                >
                  Move up
                </MenuItem>
                <MenuItem
                  icon={<ArrowDownIcon />}
                  disabled={groupIndex === -1 || groupIndex >= layout.groups.length - 1}
                  onClick={() => {
                    void changeProjectLayout((current) => moveGroup(current, group.id, 1));
                  }}
                >
                  Move down
                </MenuItem>
                <MenuItem icon={<Trash2Icon />} onClick={() => open("delete", close)}>
                  Delete group…
                </MenuItem>
              </>
            )}
            <p role="status" className="px-3 text-sm text-danger">
              {failure}
            </p>
          </>
        )}
      </Menu>
      {dialog === "pull" && scope !== null && (
        <PullDialog fleet={fleet} scope={scope} onClose={() => setDialog(null)} />
      )}
      {dialog === "clone" && (
        <GroupCloneDialog
          fleet={fleet}
          groupName={title.slice(0, maximumGroupNameLength)}
          repositories={repositories}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "edit" && group !== null && (
        <GroupDialog
          repositories={fleet.repositories}
          group={group}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "delete" && group !== null && (
        <DeleteGroupDialog group={group} onClose={() => setDialog(null)} />
      )}
    </>
  );
}
