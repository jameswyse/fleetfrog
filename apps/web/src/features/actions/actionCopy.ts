import { formatBytes } from "@/ui/formatBytes.ts";
import { plural } from "@/ui/plural.ts";
import {
  ActionOutcome,
  ActionResult,
  OutcomeKind,
  SkipReason,
} from "@fleetfrog/protocol/domain/action";
import { BatchScope, HubEvent } from "@fleetfrog/protocol/domain/activity";

import type { ActionKind, Tier } from "@fleetfrog/protocol/domain/action";
import type {
  ActionBatch,
  ActionRun,
  RunCounts,
  RunStatus,
} from "@fleetfrog/protocol/domain/activity";
import type { Operation } from "@fleetfrog/protocol/domain/checkout";

const batchPhrases = {
  Fetch: { one: "Fetch", several: "Fetch" },
  Pull: { one: "Pull", several: "Pull" },
  Clone: { one: "Clone", several: "Clone" },
  Switch: { one: "Switch branch in", several: "Switch branches" },
  Stash: { one: "Stash changes in", several: "Stash changes" },
  DeleteBranches: { one: "Delete branches in", several: "Delete branches" },
  RemoveWorktree: { one: "Remove a worktree of", several: "Remove worktrees" },
  DropStashes: { one: "Drop stashes in", several: "Drop stashes" },
  Archive: { one: "Archive", several: "Archive checkouts" },
  Unarchive: { one: "Unarchive", several: "Unarchive checkouts" },
  Trash: { one: "Trash", several: "Move checkouts to the trash" },
  Delete: { one: "Permanently delete", several: "Permanently delete checkouts" },
  Restore: { one: "Restore from the trash in", several: "Restore from the trash" },
  Purge: { one: "Permanently delete from the trash in", several: "Empty the trash" },
} satisfies Record<ActionKind, { readonly one: string; readonly several: string }>;

export function describeBatch({ kind, scope }: Pick<ActionBatch, "kind" | "scope">): string {
  const { one, several } = batchPhrases[kind];
  const expanded = kind === "Fetch" || kind === "Pull";
  const things = kind === "Pull" ? "checkout" : "repository";

  return BatchScope.match(scope, {
    Checkout: ({ repositoryName, machineName }) => `${one} ${repositoryName} on ${machineName}`,
    Repository: ({ repositoryName }) =>
      kind === "Clone" ? `Clone ${repositoryName}` : `${one} ${repositoryName} on every machine`,
    Machine: ({ machineName }) =>
      expanded ? `${one} every ${things} on ${machineName}` : `${several} on ${machineName}`,
    All: () => (expanded ? `${one} every ${things}` : `${several} on several machines`),
  });
}

export const tierNames = {
  git: "Git",
  cleanup: "cleanup",
  update: "update",
} satisfies Record<Tier, string>;

function capitalised(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

export const operationNames = {
  merge: "A merge",
  rebase: "A rebase",
  "cherry-pick": "A cherry-pick",
  revert: "A revert",
  bisect: "A bisect",
} satisfies Record<Operation, string>;

export function describeSkip(reason: SkipReason): string {
  return SkipReason.match(reason, {
    Detached: () => "Not on a branch. Switch to one first",
    NoCommits: () => "The branch has no commits yet",
    NoUpstream: () => "The branch has no upstream",
    UpstreamGone: () => "The upstream branch was deleted",
    UncommittedChanges: ({ files }) =>
      `${plural(files, "changed file")}. Commit or stash them first`,
    UnpushedCommits: ({ commits }) => `${plural(commits, "commit")} to push`,
    OperationInProgress: ({ operation }) =>
      `${operationNames[operation]} is in progress. Finish or abort it first`,
    NothingToStash: () => "There are no changes to stash",
    AlreadyOnBranch: () => "Already on that branch",
    BranchInUse: () =>
      "Another worktree has that branch checked out. Switch that worktree to another branch, or remove it, first",
    NoSuchBranch: () => "The branch no longer exists",
    BranchChanged: ({ branch }) =>
      `${branch} has new commits since the last scan. Open Tidy branches again to review it`,
    BranchCheckedOut: ({ branch }) =>
      `${branch} is checked out. Switch its worktree to another branch first`,
    DefaultBranch: ({ branch }) => `${branch} is the default branch`,
    BranchExists: ({ branch }) => `A branch called ${branch} exists now`,
    NotInTrash: () => "It's no longer in the trash",
    NoArchiveFolder: () => "No Archive folder is set. Set one in the machine's settings",
    NoSuchWorktree: () => "The worktree is no longer there",
    StashesChanged: () => "The stashes changed since the last scan",
    NoSuchStash: () => "The stashes were dropped already",
    HasWorktrees: ({ count }) =>
      `It has ${plural(count, "linked worktree")} now. Check it again to delete them with it`,
    IsWorktree: () =>
      "It's a linked worktree, which moves with its main checkout. Act on the main checkout, or remove the worktree",
    DestinationTaken: ({ path }) =>
      `Something is already at ${path}. Move or rename it, then try again`,
    DestinationsClash: ({ path }) => `Two of the folders would land at ${path}`,
    UnreachableCommits: ({ commits }) =>
      `Its detached HEAD holds ${plural(commits, "commit")} no branch has`,
    IgnoredFiles: ({ files }) =>
      `It has ${plural(files, "ignored file")} other than caches, such as .env, that would be deleted`,
    ChangedSinceInspection: () =>
      "It changed after it was checked, so it was left alone. Check it again to continue",
    UniqueWork: () =>
      "It has work that exists only on this machine now. Check it again to see what would be lost",
    NotAllowed: ({ tier }) =>
      `${capitalised(tierNames[tier])} actions are turned off on this machine. Run fleetfrog allow ${tier} on it to turn them on`,
    AgentOutdated: () => "The machine's agent is too old for this. Update FleetFrog on it",
  });
}

function sentences(parts: ReadonlyArray<string | false>): string {
  return parts.filter((part) => part !== false).join(". ");
}

function describeResult(result: ActionResult): string {
  return ActionResult.match(result, {
    Fetched: () => "Fetched",
    FastForwarded: ({ commits }) => `Pulled ${plural(commits, "commit")}`,
    UpToDate: () => "Already up to date",
    Cloned: () => "Cloned",
    Switched: ({ branch, stashedFiles, savedCommits }) =>
      sentences([
        `Switched to ${branch}`,
        stashedFiles > 0 && `Stashed ${plural(stashedFiles, "changed file")} first`,
        savedCommits > 0 &&
          `Kept ${plural(savedCommits, "commit")} from the detached HEAD in the trash`,
      ]),
    Stashed: ({ files }) => `Stashed ${plural(files, "file")}`,
    BranchesDeleted: ({ branches, skipped }) => {
      const moved = `Moved ${plural(branches, "branch", "branches")} to the trash`;

      return skipped.length === 0
        ? moved
        : `${moved}. Kept ${skipped.length}: ${skipped.map(({ reason }) => describeSkip(reason)).join("; ")}`;
    },
    Archived: ({ path, worktrees }) =>
      `Archived to ${path}${worktrees.length > 0 ? `, with ${plural(worktrees.length, "worktree")}` : ""}`,
    Unarchived: ({ path, worktrees }) =>
      `Moved back to ${path}${worktrees.length > 0 ? `, with ${plural(worktrees.length, "worktree")}` : ""}`,
    WorktreeRemoved: ({ stashedFiles, savedCommits, deletedIgnored }) =>
      sentences([
        "Removed the worktree",
        stashedFiles > 0 && `Stashed ${plural(stashedFiles, "changed file")} first`,
        savedCommits > 0 && `Kept ${plural(savedCommits, "commit")} in the trash`,
        deletedIgnored > 0 &&
          `Deleted ${plural(deletedIgnored, "ignored file or folder", "ignored files or folders")}`,
      ]),
    StashesDropped: ({ stashes, missing }) =>
      `Moved ${plural(stashes, "stash", "stashes")} to the trash${missing > 0 ? `. ${plural(missing, "was", "were")} dropped already` : ""}`,
    Trashed: ({ freedBytes }) =>
      freedBytes > 0
        ? `Moved to the trash, after removing ${formatBytes(freedBytes)} of caches`
        : "Moved to the trash",
    Deleted: () => "Permanently deleted",
    Restored: ({ path, branch }) => {
      if (branch !== null) {
        return `Restored as ${branch}`;
      }

      return path === null ? "Restored" : `Restored to ${path}`;
    },
    Purged: () => "Permanently deleted",
  });
}

export interface OutcomeText {
  readonly summary: string;
  readonly detail: string | null;
}

export function describeOutcome(outcome: ActionOutcome): OutcomeText {
  return ActionOutcome.match(outcome, {
    Succeeded: ({ result }): OutcomeText => ({ summary: describeResult(result), detail: null }),
    Failed: ({ message }): OutcomeText => ({ summary: "Failed", detail: message }),
    Skipped: ({ reason }): OutcomeText => ({ summary: "Skipped", detail: describeSkip(reason) }),
    Cancelled: (): OutcomeText => ({ summary: "Cancelled", detail: null }),
    Interrupted: (): OutcomeText => ({
      summary: "Interrupted",
      detail: "The agent disconnected before it finished",
    }),
    MachineOffline: (): OutcomeText => ({ summary: "Machine offline", detail: null }),
  });
}

export const outcomeLabels = {
  Succeeded: "Succeeded",
  Failed: "Failed",
  Skipped: "Skipped",
  Cancelled: "Cancelled",
  Interrupted: "Interrupted",
  MachineOffline: "Machine offline",
} satisfies Record<OutcomeKind, string>;

export const outcomeKinds = OutcomeKind.literals;

const summaryOrder: ReadonlyArray<RunStatus> = ["Running", "Queued", ...OutcomeKind.literals];

const countPhrases = {
  Running: (value) => `${value} running`,
  Queued: (value) => `${value} waiting`,
  Succeeded: (value) => `${value} succeeded`,
  Failed: (value) => `${value} failed`,
  Skipped: (value) => `${value} skipped`,
  Cancelled: (value) => `${value} cancelled`,
  Interrupted: (value) => `${value} interrupted`,
  MachineOffline: (value) => `${value} offline`,
} satisfies Record<RunStatus, (value: number) => string>;

export function countParts(
  counts: RunCounts,
): ReadonlyArray<{ readonly status: RunStatus; readonly text: string }> {
  return summaryOrder
    .filter((status) => counts[status] > 0)
    .map((status) => ({ status, text: countPhrases[status](counts[status]) }));
}

export function describeCounts(counts: RunCounts): string {
  return countParts(counts)
    .map(({ text }) => text)
    .join(", ");
}

const activeVerbs = {
  Fetch: "Fetching",
  Pull: "Pulling",
  Clone: "Cloning",
  Switch: "Switching branch",
  Stash: "Stashing",
  DeleteBranches: "Deleting branches",
  RemoveWorktree: "Removing a worktree",
  DropStashes: "Dropping stashes",
  Archive: "Archiving",
  Unarchive: "Unarchiving",
  Trash: "Moving to the trash",
  Delete: "Deleting",
  Restore: "Restoring",
  Purge: "Deleting permanently",
} satisfies Record<ActionKind, string>;

const waitingVerbs = {
  Fetch: "fetch",
  Pull: "pull",
  Clone: "clone",
  Switch: "switch branch",
  Stash: "stash",
  DeleteBranches: "delete branches",
  RemoveWorktree: "remove a worktree",
  DropStashes: "drop stashes",
  Archive: "archive",
  Unarchive: "unarchive",
  Trash: "move to the trash",
  Delete: "delete",
  Restore: "restore",
  Purge: "delete permanently",
} satisfies Record<ActionKind, string>;

export function describeActiveRunBriefly(run: ActionRun): string {
  const kind = run.request._tag;

  return run.state._tag === "Running" ? activeVerbs[kind] : `Waiting to ${waitingVerbs[kind]}`;
}

export function describeActiveRun(run: ActionRun): string {
  const brief = describeActiveRunBriefly(run);

  if (run.state._tag !== "Running") {
    return brief;
  }

  return run.state.progress === null ? `${brief}…` : `${brief}: ${run.state.progress}`;
}

export function describeEvent(event: HubEvent): string {
  return HubEvent.match(event, {
    MachinePaired: ({ machineName }) => `Paired ${machineName}`,
    MachineRemoved: ({ machineName }) => `Removed ${machineName}`,
    MachineRenamed: ({ from, to }) => `Renamed ${from} to ${to}`,
    DiscoveryRootsChanged: ({ machineName, roots }) =>
      roots.length === 0
        ? `Removed every project folder on ${machineName}`
        : `Set the project folders on ${machineName} to ${roots.join(", ")}`,
    PollingChanged: () => "Changed the polling intervals",
    IntegrationsChanged: ({ integrations }) =>
      integrations.t3Code.enabled ? "Changed the T3 Code settings" : "Turned off T3 Code",
    ArchiveFolderChanged: ({ machineName, folder }) =>
      folder === null
        ? `Turned off archiving on ${machineName}`
        : `Set the Archive folder on ${machineName} to ${folder}`,
    ProjectFolderCreated: ({ machineName, path }) => `Created ${path} on ${machineName}`,
  });
}
