import { folderName } from "@/ui/folderName.ts";
import { plural } from "@/ui/plural.ts";

import type { ActionRun, TargetedRun } from "@fleetfrog/protocol/domain/activity";
import type { Machine } from "@fleetfrog/protocol/domain/fleet";
import type { WorktreeInspection } from "@fleetfrog/protocol/domain/trash";

import type { WorktreeInspectionState } from "./worktreeInspection.ts";

export interface FinishedWorktree {
  readonly mainPath: string;
  readonly path: string;
  readonly branch: string;
  readonly sha: string;
}

export type CleanUpCheck =
  | { readonly _tag: "Checking" }
  | { readonly _tag: "Removable"; readonly inspection: WorktreeInspection }
  | { readonly _tag: "Kept"; readonly reason: string };

type Targeted = readonly [TargetedRun, ...Array<TargetedRun>];

type FinishedRun = Pick<ActionRun, "request" | "state">;

export function cleanUpCheck(options: {
  readonly worktree: FinishedWorktree;
  readonly inspection: WorktreeInspectionState;
  readonly busy: boolean;
}): CleanUpCheck {
  const { worktree, inspection } = options;

  if (options.busy) {
    return { _tag: "Kept", reason: "T3 Code is working in it now." };
  }

  if (inspection._tag === "Checking") {
    return inspection;
  }

  if (inspection._tag === "Failed") {
    return { _tag: "Kept", reason: `Couldn't check it: ${inspection.message}` };
  }

  const { branch, changedFiles, untrackedFiles, locked, missing } = inspection.inspection;

  if (branch !== worktree.branch) {
    return {
      _tag: "Kept",
      reason: branch === null ? "Its HEAD is detached now." : `It's on ${branch} now.`,
    };
  }

  if (changedFiles + untrackedFiles > 0) {
    return {
      _tag: "Kept",
      reason: "It has changes now. Remove it on its own to choose what happens to them.",
    };
  }

  if (locked !== null) {
    return {
      _tag: "Kept",
      reason: "It's locked against removal. Remove it on its own to unlock it.",
    };
  }

  if (missing?.parentMissing === true) {
    return {
      _tag: "Kept",
      reason:
        "Its folder and the folder above it are gone, perhaps on a disk that isn't connected. Remove it on its own if you're sure.",
    };
  }

  return { _tag: "Removable", inspection: inspection.inspection };
}

export function cleanUpLosses(inspection: WorktreeInspection): string {
  const { ignored, caches } = inspection;

  if (inspection.missing !== null) {
    return "Its folder is already gone, so this only removes Git's record of it.";
  }

  const losses = [
    ignored.total > 0 &&
      `Also deletes ${plural(ignored.total, "ignored file or folder", "ignored files or folders")} for good, such as ${ignored.items
        .slice(0, 3)
        .map(({ path }) => folderName(path))
        .join(", ")}.`,
    caches.length > 0 &&
      `Caches such as ${caches
        .slice(0, 2)
        .map(({ path }) => folderName(path))
        .join(" and ")} go too, and tools rebuild them.`,
  ].filter((loss) => loss !== false);

  return losses.length === 0 ? "Nothing else is deleted." : losses.join(" ");
}

export function removalRuns(options: {
  readonly machineId: Machine["id"];
  readonly removable: ReadonlyArray<{
    readonly worktree: FinishedWorktree;
    readonly inspection: WorktreeInspection;
  }>;
}): Targeted | null {
  const [first, ...rest] = options.removable.map(({ worktree, inspection }): TargetedRun => ({
    machineId: options.machineId,
    request: {
      _tag: "RemoveWorktree",
      path: worktree.mainPath,
      worktree: worktree.path,
      fingerprint: inspection.fingerprint,
      discardChanges: false,
    },
  }));

  return first === undefined ? null : [first, ...rest];
}

function succeeded(runs: ReadonlyArray<FinishedRun>) {
  return runs.flatMap(({ request, state }) =>
    state._tag === "Finished" && state.outcome._tag === "Succeeded"
      ? [{ request, result: state.outcome.result }]
      : [],
  );
}

export function removedWorktrees(options: {
  readonly worktrees: ReadonlyArray<FinishedWorktree>;
  readonly runs: ReadonlyArray<FinishedRun>;
}): ReadonlyArray<FinishedWorktree> {
  const removed = new Set(
    succeeded(options.runs).flatMap(({ request }) =>
      request._tag === "RemoveWorktree" ? [request.worktree] : [],
    ),
  );

  return options.worktrees.filter(({ path }) => removed.has(path));
}

export function branchDeletionRuns(options: {
  readonly machineId: Machine["id"];
  readonly removed: ReadonlyArray<FinishedWorktree>;
}): Targeted | null {
  const [first, ...rest] = Array.from(
    Map.groupBy(options.removed, ({ mainPath }) => mainPath),
    ([mainPath, clone]): TargetedRun | null => {
      const branches = new Map(clone.map(({ branch, sha }) => [branch, { name: branch, sha }]));
      const [branch, ...others] = branches.values();

      return branch === undefined
        ? null
        : {
            machineId: options.machineId,
            request: { _tag: "DeleteBranches", path: mainPath, branches: [branch, ...others] },
          };
    },
  ).filter((run) => run !== null);

  return first === undefined ? null : [first, ...rest];
}

export function deletedBranchCount(runs: ReadonlyArray<FinishedRun>): number {
  return succeeded(runs).reduce(
    (sum, { result }) => (result._tag === "BranchesDeleted" ? sum + result.branches : sum),
    0,
  );
}
