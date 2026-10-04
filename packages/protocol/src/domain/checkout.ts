import { Effect, Schema } from "effect";

import { Count } from "./count.ts";
import { ReportedList, ReportedText } from "./reported.ts";
import { RepositoryIdentity } from "./repositoryIdentity.ts";

export const FileState = Schema.Literals([".", "M", "T", "A", "D", "R", "C", "U"]);
export type FileState = typeof FileState.Type;

export const ChangedFile = Schema.Struct({
  path: ReportedText,
  originalPath: Schema.NullOr(ReportedText),
  staged: FileState,
  unstaged: FileState,
});
export type ChangedFile = typeof ChangedFile.Type;

function Capped<S extends Schema.Top>(item: S) {
  return Schema.Struct({ items: ReportedList(item), total: Count });
}

export const Upstream = Schema.Struct({
  name: ReportedText,
  ahead: Count,
  behind: Count,
  gone: Schema.Boolean,
});
export type Upstream = typeof Upstream.Type;

export const Head = Schema.TaggedUnion({
  Branch: { name: ReportedText, upstream: Schema.NullOr(Upstream) },
  Detached: {},
  Unborn: { name: ReportedText },
});
export type Head = typeof Head.Type;

export const Commit = Schema.Struct({
  sha: ReportedText,
  subject: ReportedText,
  committedAt: Schema.DateTimeUtc,
});
export type Commit = typeof Commit.Type;

export const BranchTip = Schema.Struct({
  sha: ReportedText,
  subject: ReportedText,
  committedAt: Schema.DateTimeUtc,
  merged: Schema.Boolean,
  pushed: Schema.Boolean,
  localCommits: Count,
});
export type BranchTip = typeof BranchTip.Type;

export const LocalBranch = Schema.Struct({
  name: ReportedText,
  upstream: Schema.NullOr(Upstream),
  tip: Schema.NullOr(BranchTip).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(null))),
});
export type LocalBranch = typeof LocalBranch.Type;

export const Stash = Schema.Struct({
  index: Count,
  message: ReportedText,
  sha: Schema.NullOr(ReportedText).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(null))),
});
export type Stash = typeof Stash.Type;

export const Operation = Schema.Literals(["merge", "rebase", "cherry-pick", "revert", "bisect"]);
export type Operation = typeof Operation.Type;

export const DeletedBranch = Schema.Struct({
  name: ReportedText,
  ref: ReportedText,
  sha: ReportedText,
  subject: ReportedText,
  deletedAt: Schema.DateTimeUtc,
});
export type DeletedBranch = typeof DeletedBranch.Type;

export const DroppedStash = Schema.Struct({
  ref: ReportedText,
  sha: ReportedText,
  message: ReportedText,
  droppedAt: Schema.DateTimeUtc,
});
export type DroppedStash = typeof DroppedStash.Type;

export const droppedStashPrefix = "refs/fleetfrog/stashes/";

const droppedStashPattern = /^refs\/fleetfrog\/stashes\/(\d+)\/\d+$/;

export function parseDroppedStashRef(ref: string): { readonly droppedAtMillis: number } | null {
  const match = droppedStashPattern.exec(ref);

  return match?.[1] === undefined ? null : { droppedAtMillis: Number(match[1]) };
}

export const LinkedWorktree = Schema.Struct({
  path: ReportedText,
  branch: Schema.NullOr(ReportedText),
  state: Schema.Literals(["Present", "Missing", "Broken"]),
});
export type LinkedWorktree = typeof LinkedWorktree.Type;

export const deletedBranchPrefix = "refs/fleetfrog/deleted/";

const deletedRefPattern = /^refs\/fleetfrog\/deleted\/(\d+)\/(.+)$/;

export function parseDeletedRef(
  ref: string,
): { readonly name: string; readonly deletedAtMillis: number } | null {
  const match = deletedRefPattern.exec(ref);

  return match?.[1] === undefined || match[2] === undefined
    ? null
    : { name: match[2], deletedAtMillis: Number(match[1]) };
}

const noneYet = Effect.succeed({ items: [], total: 0 });

export const GitStatus = Schema.Struct({
  head: Head,
  operation: Schema.NullOr(Operation).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(null))),
  lastCommit: Schema.NullOr(Commit),
  changed: Capped(ChangedFile),
  untracked: Capped(ReportedText),
  stashes: Capped(Stash),
  branches: Capped(LocalBranch),
  defaultBranch: Schema.NullOr(ReportedText).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(null)),
  ),
  deletedBranches: Capped(DeletedBranch).pipe(Schema.withDecodingDefaultTypeKey(noneYet)),
  droppedStashes: Capped(DroppedStash).pipe(Schema.withDecodingDefaultTypeKey(noneYet)),
  worktrees: ReportedList(LinkedWorktree).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed([])),
  ),
  lastFetchedAt: Schema.NullOr(Schema.DateTimeUtc),
});
export type GitStatus = typeof GitStatus.Type;

export const MergedPullRequest = Schema.Struct({
  number: Count,
  url: ReportedText,
  branch: ReportedText,
  sha: ReportedText,
});
export type MergedPullRequest = typeof MergedPullRequest.Type;

export const PullRequest = Schema.Struct({
  number: Count,
  title: ReportedText,
  url: ReportedText,
  branch: ReportedText,
  draft: Schema.Boolean,
});
export type PullRequest = typeof PullRequest.Type;

export const GithubState = Schema.Struct({
  defaultBranch: ReportedText,
  remoteSha: ReportedText,
  trackingSha: Schema.NullOr(ReportedText),
  pullRequests: ReportedList(PullRequest),
  mergedPullRequests: ReportedList(MergedPullRequest).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed([])),
  ),
  checkedAt: Schema.DateTimeUtc,
});
export type GithubState = typeof GithubState.Type;

export const CheckoutStatus = Schema.TaggedUnion({
  Read: { git: GitStatus },
  Failed: { message: ReportedText },
});
export type CheckoutStatus = typeof CheckoutStatus.Type;

export const Worktree = Schema.TaggedUnion({
  Main: {},
  Linked: { mainPath: ReportedText },
});
export type Worktree = typeof Worktree.Type;

export const Placement = Schema.TaggedUnion({
  Projects: {},
  Archive: {
    originalPath: Schema.NullOr(ReportedText),
    archivedAt: Schema.NullOr(Schema.DateTimeUtc),
  },
});
export type Placement = typeof Placement.Type;

export const Checkout = Schema.Struct({
  path: ReportedText,
  identity: RepositoryIdentity,
  originUrl: Schema.NullOr(ReportedText).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(null)),
  ),
  directoryName: ReportedText,
  worktree: Worktree,
  placement: Placement.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(Placement.cases.Projects.make({}))),
  ),
  status: CheckoutStatus,
  github: Schema.NullOr(GithubState),
  scannedAt: Schema.DateTimeUtc,
});
export type Checkout = typeof Checkout.Type;

export function clonePath(checkout: Pick<Checkout, "path" | "worktree">): string {
  return checkout.worktree._tag === "Main" ? checkout.path : checkout.worktree.mainPath;
}
