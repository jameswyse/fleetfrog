import { useState } from "react";

import { useMayRun } from "@/rpc/session.ts";
import { folderName } from "@/ui/folderName.ts";

import { machineBlocker } from "../../actions/actionAvailability.ts";
import { CleanUpWorktreesDialog } from "../../cleanup/CleanUpWorktreesDialog.tsx";
import { workingTreesOf } from "../workingTrees.ts";
import { ParkedBranches } from "./ParkedBranches.tsx";
import { StashesSection } from "./StashesSection.tsx";
import { SuggestedActions } from "./SuggestedActions.tsx";
import { WorkingTreeOutline } from "./WorkingTreeOutline.tsx";

import type { Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

import type { FinishedWorktree } from "../../cleanup/worktreeCleanUp.ts";
import type { CloneOutline } from "../workingTrees.ts";
import type { GroupKind } from "./WorkingTreeOutline.tsx";

type GroupOverrides = ReadonlyMap<string, ReadonlyMap<GroupKind, boolean>>;

const noGroupOverrides: GroupOverrides = new Map();

function finishedWorktrees(clones: ReadonlyArray<CloneOutline>): ReadonlyArray<FinishedWorktree> {
  return clones.flatMap((clone) =>
    clone.linked.flatMap(({ path, branch, git, lifecycle }) =>
      lifecycle._tag !== "Finished" || branch === null || git === null || git.lastCommit === null
        ? []
        : [{ mainPath: clone.path, path, branch, sha: git.lastCommit.sha }],
    ),
  );
}

export function WorkingTreesTab({
  repository,
  machine,
  clones,
  selectedPath,
  onChoosePath,
}: {
  readonly repository: Repository;
  readonly machine: Machine;
  readonly clones: ReadonlyArray<CloneOutline>;
  readonly selectedPath: string;
  readonly onChoosePath: (path: string) => void;
}) {
  const [cleaning, setCleaning] = useState<ReadonlyArray<FinishedWorktree> | null>(null);
  const [closedPath, setClosedPath] = useState<string | null>(null);
  const [groupOverrides, setGroupOverrides] = useState(noGroupOverrides);
  const [lastSelectedPath, setLastSelectedPath] = useState(selectedPath);

  if (lastSelectedPath !== selectedPath) {
    setLastSelectedPath(selectedPath);
    setClosedPath(null);
    setGroupOverrides(noGroupOverrides);
  }

  const expandedPath = closedPath === selectedPath ? null : selectedPath;

  const choosePath = (path: string) => {
    setClosedPath(null);
    setGroupOverrides(noGroupOverrides);
    onChoosePath(path);
  };

  const toggleGroup = (clonePath: string, kind: GroupKind, open: boolean) =>
    setGroupOverrides(
      new Map([
        ...groupOverrides,
        [clonePath, new Map([...(groupOverrides.get(clonePath) ?? []), [kind, open]])],
      ]),
    );

  const togglePath = (path: string) =>
    path === expandedPath ? setClosedPath(path) : choosePath(path);

  const mayRemove = useMayRun("RemoveWorktree");
  const mayDelete = useMayRun("DeleteBranches");

  const mayCleanUp =
    mayRemove &&
    mayDelete &&
    machineBlocker(machine, "RemoveWorktree") === null &&
    machineBlocker(machine, "DeleteBranches") === null;

  const cleanUp = (scope: ReadonlyArray<CloneOutline>) => {
    const finished = finishedWorktrees(scope);

    return mayCleanUp && finished.length > 0 ? () => setCleaning(finished) : null;
  };

  const treeCount = clones.flatMap(workingTreesOf).length;

  return (
    <div className="space-y-5">
      <SuggestedActions
        machine={machine}
        clones={clones}
        onChoosePath={choosePath}
        onCleanUp={cleanUp(clones)}
      />
      {clones.map((clone) => (
        <div key={clone.path} className="space-y-5">
          <WorkingTreeOutline
            repository={repository}
            machine={machine}
            clone={clone}
            title={
              clones.length > 1
                ? `Clone in ${folderName(clone.path)}`
                : treeCount > 1
                  ? "Working trees"
                  : null
            }
            selectedPath={selectedPath}
            expandedPath={expandedPath}
            groupOverrides={groupOverrides.get(clone.path) ?? new Map()}
            onTogglePath={togglePath}
            onToggleGroup={(kind, open) => toggleGroup(clone.path, kind, open)}
            onChoosePath={choosePath}
            onCleanUp={cleanUp([clone])}
          />
          <ParkedBranches repository={repository} machine={machine} clone={clone} />
          {clone.anchor !== null && clone.anchor.git.stashes.total > 0 && (
            <StashesSection
              machine={machine}
              checkout={clone.anchor.checkout}
              git={clone.anchor.git}
            />
          )}
        </div>
      ))}
      {cleaning !== null && (
        <CleanUpWorktreesDialog
          machine={machine}
          worktrees={cleaning}
          finished={finishedWorktrees(clones)}
          onClose={() => setCleaning(null)}
        />
      )}
    </div>
  );
}
