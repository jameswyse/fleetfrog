import { Effect, Schema } from "effect";

import { Commit, Operation } from "./checkout.ts";
import { Count } from "./count.ts";
import { RepositoryIdentity } from "./repositoryIdentity.ts";

export const TrashId = Schema.String.pipe(Schema.check(Schema.isUUID()), Schema.brand("TrashId"));
export type TrashId = typeof TrashId.Type;

/** A checkout moved to a machine's trash, kept whole until the trash is emptied. */
export const TrashedCheckout = Schema.Struct({
  id: TrashId,
  /** Where it was, and where restoring it puts it back. */
  originalPath: Schema.String,
  identity: RepositoryIdentity,
  directoryName: Schema.String,
  branch: Schema.NullOr(Schema.String),
  lastCommit: Schema.NullOr(Commit),
  trashedAt: Schema.DateTimeUtc,
  /** What it takes up in the trash, after any caches were removed. */
  sizeBytes: Count,
  /** Linked worktrees trashed with it, which restoring puts back too. */
  worktrees: Schema.Array(
    Schema.Struct({ originalPath: Schema.String, trashedPath: Schema.String }),
  ).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
});
export type TrashedCheckout = typeof TrashedCheckout.Type;

/** A file or folder inside a checkout, relative to it, with what it takes up on disk. */
export const SizedPath = Schema.Struct({ path: Schema.String, sizeBytes: Count });
export type SizedPath = typeof SizedPath.Type;

/** Whether the checkout's remotes could be fetched just before it was inspected. */
export const RemoteCheck = Schema.TaggedUnion({
  Fetched: {},
  NoRemote: {},
  Unreachable: { message: Schema.String },
});
export type RemoteCheck = typeof RemoteCheck.Type;

/**
 * What deleting a checkout would lose, found by fetching its remotes and then reading it. The
 * fingerprint changes when a commit, branch, tag, stash, changed or untracked path, or ignored
 * entry is added or removed, so a request made from this inspection is refused if the checkout
 * has changed that way since.
 */
export const Inspection = Schema.Struct({
  fingerprint: Schema.String,
  sizeBytes: Count,
  remote: RemoteCheck,
  /** Local branches with commits no remote-tracking branch has. */
  unpushedBranches: Schema.Array(Schema.Struct({ name: Schema.String, commits: Count })),
  /** Commits on any ref or HEAD that no remote-tracking branch has, stashes included. */
  unpushedCommits: Count,
  /** Tags no remote has, even when their commits are pushed. */
  unpushedTags: Count,
  /** A merge, rebase or similar part-way through, whose state lives only in this checkout. */
  operation: Schema.NullOr(Operation),
  /** Submodules with Git directories inside this checkout, whose work isn't inspected. */
  submodules: Count,
  stashes: Count,
  changedFiles: Count,
  untrackedFiles: Count,
  /** Ignored files and folders that aren't known caches, largest first. */
  ignored: Schema.Struct({ items: Schema.Array(SizedPath), total: Count }),
  /** Ignored dependency and build folders, such as `node_modules`, which can be rebuilt. */
  caches: Schema.Array(SizedPath),
  linkedWorktrees: Count,
});
export type Inspection = typeof Inspection.Type;

/**
 * What removing a linked worktree would do, found by reading it. Its changes would be stashed and
 * its detached HEAD's own commits kept in the trash, so only its ignored files other than caches
 * are lost. The fingerprint changes when its HEAD, changes or ignored entries do.
 */
export const WorktreeInspection = Schema.Struct({
  fingerprint: Schema.String,
  path: Schema.String,
  /** The folder is gone, and `parentMissing` says whether the folder above it is too. */
  missing: Schema.NullOr(Schema.Struct({ parentMissing: Schema.Boolean })),
  branch: Schema.NullOr(Schema.String),
  /** Why Git was told to keep the worktree, when it was locked, or an empty reason. */
  locked: Schema.NullOr(Schema.String),
  changedFiles: Count,
  untrackedFiles: Count,
  /** Commits only its detached HEAD holds. */
  unreachableCommits: Count,
  /** Ignored files and folders that aren't known caches, largest first. */
  ignored: Schema.Struct({ items: Schema.Array(SizedPath), total: Count }),
  caches: Schema.Array(SizedPath),
});
export type WorktreeInspection = typeof WorktreeInspection.Type;

export const InspectionResult = Schema.TaggedUnion({
  Inspected: { inspection: Inspection },
  WorktreeInspected: { inspection: WorktreeInspection },
  Failed: { message: Schema.String },
});
export type InspectionResult = typeof InspectionResult.Type;

/**
 * Whether everything in the checkout can be had again from its remotes or rebuilt, so deleting it
 * for good loses nothing. Otherwise the dashboard warns before deleting, and asks the agent to
 * delete regardless; without that, the agent checks again and keeps a checkout with unique work.
 */
export function nothingUnique(inspection: Inspection): boolean {
  return (
    inspection.remote._tag === "Fetched" &&
    inspection.unpushedCommits === 0 &&
    inspection.unpushedTags === 0 &&
    inspection.operation === null &&
    inspection.submodules === 0 &&
    inspection.stashes === 0 &&
    inspection.changedFiles === 0 &&
    inspection.untrackedFiles === 0 &&
    inspection.ignored.total === 0
  );
}
