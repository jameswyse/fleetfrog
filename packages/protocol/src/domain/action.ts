import { Effect, Schema, SchemaGetter } from "effect";

import { Operation } from "./checkout.ts";
import { Count } from "./count.ts";
import { TrashId } from "./trash.ts";

/**
 * A group of actions that a machine's owner allows or denies on that machine, with
 * `fleetfrog allow` and `fleetfrog deny`. The hub can see the policy but never change it. `git`
 * covers fetching, pulling, cloning, switching branches and stashing, and creating the project
 * folders that clones go into. `cleanup` covers actions that remove things from where the
 * developer works: archiving, the trash and permanent deletion.
 */
export const Tier = Schema.Literals(["git", "cleanup"]);
export type Tier = typeof Tier.Type;

export const BranchAtCommit = Schema.Struct({ name: Schema.String, sha: Schema.String });
export type BranchAtCommit = typeof BranchAtCommit.Type;

/** Something in a machine's trash. */
export const TrashTarget = Schema.TaggedUnion({
  /** A deleted branch, kept as `ref` in the repository of the checkout at `path`. */
  Branch: { path: Schema.String, ref: Schema.String },
  /** A dropped stash, kept as `ref` in the repository of the checkout at `path`. */
  Stash: { path: Schema.String, ref: Schema.String },
  Checkout: { id: TrashId },
});
export type TrashTarget = typeof TrashTarget.Type;

/**
 * What the hub can ask an agent to do. Parameters are references that the agent resolves and
 * checks itself, never commands: a checkout it reported, or a remote URL and a destination that it
 * validates before cloning.
 */
export const ActionRequest = Schema.TaggedUnion({
  /** Fetches every remote of the repository whose checkout is at `path`. */
  Fetch: { path: Schema.String },
  /** Fetches, then fast-forwards the branch checked out at `path` if it has only commits to pull. */
  Pull: { path: Schema.String },
  /** Clones `url` into `destination`, which may start with `~`. */
  Clone: { url: Schema.String, destination: Schema.String },
  /**
   * Switches the checkout at `path` to the local branch `branch`. Changes to tracked files are
   * stashed first with `stashChanges`, and otherwise stop the switch. Commits only a detached HEAD
   * holds go to the trash as a branch.
   */
  Switch: {
    path: Schema.String,
    branch: Schema.String,
    stashChanges: Schema.Boolean.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(false))),
  },
  /** Stashes every change in the checkout at `path`, including untracked files. */
  Stash: { path: Schema.String },
  /**
   * Moves local branches of the checkout at `path` to the trash, each only if its tip is still the
   * commit the dashboard showed and no worktree has it checked out. The rest are left alone.
   */
  DeleteBranches: { path: Schema.String, branches: Schema.NonEmptyArray(BranchAtCommit) },
  /**
   * Removes a linked worktree of the main checkout at `path`, keeping its branch, if it still
   * matches the inspection that produced `fingerprint`. Its changes are stashed and commits only
   * its detached HEAD holds go to the trash as a branch, so only ignored files are lost. One whose
   * folder is gone is forgotten.
   */
  RemoveWorktree: { path: Schema.String, worktree: Schema.String, fingerprint: Schema.String },
  /**
   * Moves stashes of the checkout at `path` to the trash, each found by its commit, since dropping
   * one renumbers the rest. A stash that's gone already is left out.
   */
  DropStashes: {
    path: Schema.String,
    stashes: Schema.NonEmptyArray(Schema.Struct({ index: Count, sha: Schema.String })),
  },
  /**
   * Moves the checkout at `path` into the Archive folder, keeping its path below its project
   * folder, or with a number added when something is already there. Its linked worktrees move too,
   * each the same way.
   */
  Archive: { path: Schema.String },
  /**
   * Moves the archived checkout at `path` back to where it was archived from, or with a number
   * added when something is there now.
   */
  Unarchive: { path: Schema.String },
  /**
   * Moves the checkout at `path` to the machine's trash, with its linked worktrees, if it still
   * matches the inspection that produced `fingerprint`. With `removeCaches`, dependency and build
   * folders are then deleted from the trashed copy.
   */
  Trash: { path: Schema.String, fingerprint: Schema.String, removeCaches: Schema.Boolean },
  /**
   * Deletes the checkout at `path` for good, only if it still matches `fingerprint`. Unless the
   * developer accepted losing it with `discardUniqueWork`, a fresh inspection must also find
   * nothing that exists only here and no linked worktrees, which otherwise go with it.
   */
  Delete: {
    path: Schema.String,
    fingerprint: Schema.String,
    discardUniqueWork: Schema.Boolean.pipe(
      Schema.withDecodingDefaultTypeKey(Effect.succeed(false)),
    ),
  },
  /**
   * Puts something back from the trash. A branch whose name is taken comes back with `-restored`
   * added, and a checkout whose place is taken with a number added.
   */
  Restore: { target: TrashTarget },
  /** Deletes something in the trash for good. */
  Purge: { target: TrashTarget },
});
export type ActionRequest = typeof ActionRequest.Type;

export const ActionKind = Schema.Literals([
  "Fetch",
  "Pull",
  "Clone",
  "Switch",
  "Stash",
  "DeleteBranches",
  "RemoveWorktree",
  "DropStashes",
  "Archive",
  "Unarchive",
  "Trash",
  "Delete",
  "Restore",
  "Purge",
]);
export type ActionKind = typeof ActionKind.Type;

export const actionTiers = {
  Fetch: "git",
  Pull: "git",
  Clone: "git",
  Switch: "git",
  Stash: "git",
  DeleteBranches: "cleanup",
  RemoveWorktree: "cleanup",
  DropStashes: "cleanup",
  Archive: "cleanup",
  Unarchive: "cleanup",
  Trash: "cleanup",
  Delete: "cleanup",
  Restore: "cleanup",
  Purge: "cleanup",
} as const satisfies Record<ActionRequest["_tag"], Tier>;

/** Actions the dashboard addresses to one target each, rather than to a scope the hub expands. */
export const TargetedRequest = Schema.Union([
  ActionRequest.cases.Switch,
  ActionRequest.cases.Stash,
  ActionRequest.cases.DeleteBranches,
  ActionRequest.cases.RemoveWorktree,
  ActionRequest.cases.DropStashes,
  ActionRequest.cases.Archive,
  ActionRequest.cases.Unarchive,
  ActionRequest.cases.Trash,
  ActionRequest.cases.Delete,
  ActionRequest.cases.Restore,
  ActionRequest.cases.Purge,
]);
export type TargetedRequest = typeof TargetedRequest.Type;

/**
 * A list of names that keeps only those this version of FleetFrog knows. The hub and agents update
 * separately, so each side ignores names the other has added instead of refusing the connection.
 */
function knownNames<const Names extends ReadonlyArray<string>>(names: Schema.Literals<Names>) {
  const isKnown = Schema.is(names);

  return Schema.Array(Schema.String).pipe(
    Schema.decodeTo(Schema.Array(names), {
      decode: SchemaGetter.transform((values) => values.filter(isKnown)),
      encode: SchemaGetter.transform((values) => values),
    }),
  );
}

/** What a connected agent can run and what its owner allows. */
export const AgentCapabilities = Schema.Struct({
  /** Actions from a newer agent that this hub doesn't know are left out. */
  actions: knownNames(ActionKind),
  allowedTiers: knownNames(Tier),
  /** False when the policy file is damaged, which allows nothing until the owner fixes it. */
  policyReadable: Schema.Boolean,
  /** Whether the agent can create a missing project folder. Agents from before it say nothing. */
  createsFolders: Schema.Boolean.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(false))),
});
export type AgentCapabilities = typeof AgentCapabilities.Type;

/** Agents from before actions existed advertise nothing, so the hub sends them none. */
export const AdvertisedCapabilities = AgentCapabilities.pipe(
  Schema.withDecodingDefaultTypeKey(
    Effect.succeed({ actions: [], allowedTiers: [], policyReadable: true, createsFolders: false }),
  ),
);

/** Why an action did not apply to its target. Nothing was changed. */
export const SkipReason = Schema.TaggedUnion({
  Detached: {},
  /** The branch has no commits yet. */
  NoCommits: {},
  NoUpstream: {},
  UpstreamGone: {},
  UncommittedChanges: { files: Count },
  UnpushedCommits: { commits: Count },
  /** A merge, rebase or similar is part-way through, and the developer should finish it. */
  OperationInProgress: { operation: Operation },
  NothingToStash: {},
  AlreadyOnBranch: {},
  /** The branch is checked out in another worktree, which Git doesn't allow twice. */
  BranchInUse: {},
  NoSuchBranch: {},
  /** The branch has new commits since the dashboard showed it, so it was left alone. */
  BranchChanged: { branch: Schema.String },
  /** A branch to delete is checked out in one of the clone's worktrees. */
  BranchCheckedOut: { branch: Schema.String },
  DefaultBranch: { branch: Schema.String },
  /** A branch to restore has the name of one that exists now. */
  BranchExists: { branch: Schema.String },
  /** The item is no longer in the trash. */
  NotInTrash: {},
  NoArchiveFolder: {},
  NoSuchWorktree: {},
  /** The stashes changed after the dashboard showed them, so none were dropped. */
  StashesChanged: {},
  /** Every stash to drop was gone already. */
  NoSuchStash: {},
  /** A checkout with linked worktrees can't move without breaking them. */
  HasWorktrees: { count: Count },
  /** A linked worktree moves with its main checkout, not on its own. */
  IsWorktree: {},
  /** Something is already where the checkout would move to. */
  DestinationTaken: { path: Schema.String },
  /** Two of the folders moving together would land at or inside the same place. */
  DestinationsClash: { path: Schema.String },
  /** A detached HEAD holds commits no branch, tag or remote has, which removing it would lose. */
  UnreachableCommits: { commits: Count },
  /** Files Git ignores that aren't caches, such as `.env`, which removing it would delete. */
  IgnoredFiles: { files: Count },
  /** The checkout changed after it was inspected, so it was left alone. */
  ChangedSinceInspection: {},
  /** Deleting for good would lose work that exists only on this machine. */
  UniqueWork: {},
  /** The machine's owner has not allowed the action's tier. */
  NotAllowed: { tier: Tier },
  /** The agent is too old to know the action. */
  AgentOutdated: {},
});
export type SkipReason = typeof SkipReason.Type;

export const ActionResult = Schema.TaggedUnion({
  Fetched: {},
  FastForwarded: { commits: Count },
  UpToDate: {},
  Cloned: {},
  /** `stashedFiles` were stashed first, and `savedCommits` from a detached HEAD went to the trash. */
  Switched: {
    branch: Schema.String,
    stashedFiles: Count.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(0))),
    savedCommits: Count.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(0))),
  },
  Stashed: { files: Count },
  /** `skipped` names the requested branches left alone, each with why. */
  BranchesDeleted: {
    branches: Count,
    skipped: Schema.Array(Schema.Struct({ branch: Schema.String, reason: SkipReason })).pipe(
      Schema.withDecodingDefaultTypeKey(Effect.succeed([])),
    ),
  },
  /** `path` is where the checkout is now, and `worktrees` where each linked worktree went. */
  Archived: {
    path: Schema.String,
    worktrees: Schema.Array(Schema.Struct({ from: Schema.String, to: Schema.String })).pipe(
      Schema.withDecodingDefaultTypeKey(Effect.succeed([])),
    ),
  },
  Unarchived: {
    path: Schema.String,
    worktrees: Schema.Array(Schema.Struct({ from: Schema.String, to: Schema.String })).pipe(
      Schema.withDecodingDefaultTypeKey(Effect.succeed([])),
    ),
  },
  /**
   * `stashedFiles` were stashed first, `savedCommits` from a detached HEAD went to the trash and
   * `deletedIgnored` ignored entries other than caches were deleted with the folder.
   */
  WorktreeRemoved: {
    stashedFiles: Count.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(0))),
    savedCommits: Count.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(0))),
    deletedIgnored: Count.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(0))),
  },
  /** `missing` counts the stashes that were gone already. */
  StashesDropped: {
    stashes: Count,
    missing: Count.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(0))),
  },
  /** `freedBytes` counts the caches removed from the trashed copy. */
  Trashed: { freedBytes: Count },
  Deleted: {},
  /**
   * `path` is where a restored checkout is now, and null otherwise. `branch` is the name a
   * restored branch came back as, and null otherwise.
   */
  Restored: {
    path: Schema.NullOr(Schema.String).pipe(
      Schema.withDecodingDefaultTypeKey(Effect.succeed(null)),
    ),
    branch: Schema.NullOr(Schema.String).pipe(
      Schema.withDecodingDefaultTypeKey(Effect.succeed(null)),
    ),
  },
  Purged: {},
});
export type ActionResult = typeof ActionResult.Type;

export const ActionOutcome = Schema.TaggedUnion({
  Succeeded: { result: ActionResult },
  /** The action ran and failed. `message` is usually Git's own error. */
  Failed: { message: Schema.String },
  Skipped: { reason: SkipReason },
  Cancelled: {},
  /** The agent disconnected before reporting a result, so what happened is unknown. */
  Interrupted: {},
  MachineOffline: {},
});
export type ActionOutcome = typeof ActionOutcome.Type;
export type OutcomeKind = ActionOutcome["_tag"];

export const OutcomeKind = Schema.Literals([
  "Succeeded",
  "Failed",
  "Skipped",
  "Cancelled",
  "Interrupted",
  "MachineOffline",
]);

/** How far an action has got, as the agent reports it. */
export const ActionUpdate = Schema.TaggedUnion({
  /** The action has its locks and is running. */
  Started: {},
  /** Git's latest progress line. */
  Progress: { line: Schema.String },
  /** The last lines of Git's output travel with the outcome. */
  Finished: { outcome: ActionOutcome, output: Schema.Array(Schema.String) },
});
export type ActionUpdate = typeof ActionUpdate.Type;
