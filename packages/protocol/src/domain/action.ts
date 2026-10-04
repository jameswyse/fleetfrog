import { Effect, Schema, SchemaGetter } from "effect";

import { Operation } from "./checkout.ts";
import { Count } from "./count.ts";
import { ReportedList, ReportedText } from "./reported.ts";
import { TrashId } from "./trash.ts";

export const Tier = Schema.Literals(["git", "cleanup", "update"]);
export type Tier = typeof Tier.Type;

export const RefName = Schema.String.check(
  Schema.isMaxLength(1024),
  Schema.makeFilter((name) => /^[^\s\p{C}-][^\s\p{C}]*$/u.test(name) || "must be a ref name"),
);

export const maximumListedItems = 1000;

export const BranchAtCommit = Schema.Struct({ name: RefName, sha: Schema.String });
export type BranchAtCommit = typeof BranchAtCommit.Type;

export const TrashTarget = Schema.TaggedUnion({
  Branch: { path: Schema.String, ref: RefName },
  Stash: { path: Schema.String, ref: RefName },
  Checkout: { id: TrashId },
});
export type TrashTarget = typeof TrashTarget.Type;

export const ActionRequest = Schema.TaggedUnion({
  Fetch: { path: Schema.String },
  Pull: { path: Schema.String },
  Clone: { url: Schema.String, destination: Schema.String },
  Switch: {
    path: Schema.String,
    branch: RefName,
    stashChanges: Schema.Boolean.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(false))),
  },
  Stash: { path: Schema.String },
  DeleteBranches: {
    path: Schema.String,
    branches: Schema.NonEmptyArray(BranchAtCommit).check(Schema.isMaxLength(maximumListedItems)),
  },
  RemoveWorktree: { path: Schema.String, worktree: Schema.String, fingerprint: Schema.String },
  DropStashes: {
    path: Schema.String,
    stashes: Schema.NonEmptyArray(Schema.Struct({ index: Count, sha: Schema.String })).check(
      Schema.isMaxLength(maximumListedItems),
    ),
  },
  Archive: { path: Schema.String },
  Unarchive: { path: Schema.String },
  Trash: { path: Schema.String, fingerprint: Schema.String, removeCaches: Schema.Boolean },
  Delete: {
    path: Schema.String,
    fingerprint: Schema.String,
    discardUniqueWork: Schema.Boolean.pipe(
      Schema.withDecodingDefaultTypeKey(Effect.succeed(false)),
    ),
  },
  Restore: { target: TrashTarget },
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

export function knownNames<const Names extends ReadonlyArray<string>>(
  names: Schema.Literals<Names>,
) {
  const isKnown = Schema.is(names);

  return Schema.Array(Schema.String).pipe(
    Schema.decodeTo(Schema.Array(names), {
      decode: SchemaGetter.transform((values) => values.filter(isKnown)),
      encode: SchemaGetter.transform((values) => values),
    }),
  );
}

export const AgentCapabilities = Schema.Struct({
  actions: knownNames(ActionKind),
  allowedTiers: knownNames(Tier),
  policyReadable: Schema.Boolean,
  createsFolders: Schema.Boolean.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(false))),
  updatesItself: Schema.Boolean.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(false))),
});
export type AgentCapabilities = typeof AgentCapabilities.Type;

export const AdvertisedCapabilities = AgentCapabilities.pipe(
  Schema.withDecodingDefaultTypeKey(
    Effect.succeed({
      actions: [],
      allowedTiers: [],
      policyReadable: true,
      createsFolders: false,
      updatesItself: false,
    }),
  ),
);

export const SkipReason = Schema.TaggedUnion({
  Detached: {},
  NoCommits: {},
  NoUpstream: {},
  UpstreamGone: {},
  UncommittedChanges: { files: Count },
  UnpushedCommits: { commits: Count },
  OperationInProgress: { operation: Operation },
  NothingToStash: {},
  AlreadyOnBranch: {},
  BranchInUse: {},
  NoSuchBranch: {},
  BranchChanged: { branch: ReportedText },
  BranchCheckedOut: { branch: ReportedText },
  DefaultBranch: { branch: ReportedText },
  BranchExists: { branch: ReportedText },
  NotInTrash: {},
  NoArchiveFolder: {},
  NoSuchWorktree: {},
  StashesChanged: {},
  NoSuchStash: {},
  HasWorktrees: { count: Count },
  IsWorktree: {},
  DestinationTaken: { path: ReportedText },
  DestinationsClash: { path: ReportedText },
  UnreachableCommits: { commits: Count },
  IgnoredFiles: { files: Count },
  ChangedSinceInspection: {},
  UniqueWork: {},
  NotAllowed: { tier: Tier },
  AgentOutdated: {},
});
export type SkipReason = typeof SkipReason.Type;

export const ActionResult = Schema.TaggedUnion({
  Fetched: {},
  FastForwarded: { commits: Count },
  UpToDate: {},
  Cloned: {},
  Switched: {
    branch: ReportedText,
    stashedFiles: Count.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(0))),
    savedCommits: Count.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(0))),
  },
  Stashed: { files: Count },
  BranchesDeleted: {
    branches: Count,
    skipped: ReportedList(Schema.Struct({ branch: ReportedText, reason: SkipReason })).pipe(
      Schema.withDecodingDefaultTypeKey(Effect.succeed([])),
    ),
  },
  Archived: {
    path: ReportedText,
    worktrees: ReportedList(Schema.Struct({ from: ReportedText, to: ReportedText })).pipe(
      Schema.withDecodingDefaultTypeKey(Effect.succeed([])),
    ),
  },
  Unarchived: {
    path: ReportedText,
    worktrees: ReportedList(Schema.Struct({ from: ReportedText, to: ReportedText })).pipe(
      Schema.withDecodingDefaultTypeKey(Effect.succeed([])),
    ),
  },
  WorktreeRemoved: {
    stashedFiles: Count.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(0))),
    savedCommits: Count.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(0))),
    deletedIgnored: Count.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(0))),
  },
  StashesDropped: {
    stashes: Count,
    missing: Count.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(0))),
  },
  Trashed: { freedBytes: Count },
  Deleted: {},
  Restored: {
    path: Schema.NullOr(ReportedText).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(null))),
    branch: Schema.NullOr(ReportedText).pipe(
      Schema.withDecodingDefaultTypeKey(Effect.succeed(null)),
    ),
  },
  Purged: {},
});
export type ActionResult = typeof ActionResult.Type;

export const ActionOutcome = Schema.TaggedUnion({
  Succeeded: { result: ActionResult },
  Failed: { message: ReportedText },
  Skipped: { reason: SkipReason },
  Cancelled: {},
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

export const ActionUpdate = Schema.TaggedUnion({
  Started: {},
  Progress: { line: ReportedText },
  Finished: { outcome: ActionOutcome, output: ReportedList(ReportedText) },
});
export type ActionUpdate = typeof ActionUpdate.Type;
