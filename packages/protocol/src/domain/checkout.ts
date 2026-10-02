import { Effect, Schema } from "effect";

import { Count } from "./count.ts";
import { ReportedList, ReportedText } from "./reported.ts";
import { RepositoryIdentity } from "./repositoryIdentity.ts";

/** Git's porcelain status letters for one side (index or worktree) of a changed path. */
export const FileState = Schema.Literals([".", "M", "T", "A", "D", "R", "C", "U"]);
export type FileState = typeof FileState.Type;

export const ChangedFile = Schema.Struct({
  path: ReportedText,
  /** The path before a rename or copy. */
  originalPath: Schema.NullOr(ReportedText),
  staged: FileState,
  unstaged: FileState,
});
export type ChangedFile = typeof ChangedFile.Type;

/** A list truncated to a fixed length, with the full count kept so the dashboard can say "and N more". */
function Capped<S extends Schema.Top>(item: S) {
  return Schema.Struct({ items: ReportedList(item), total: Count });
}

export const Upstream = Schema.Struct({
  name: ReportedText,
  ahead: Count,
  behind: Count,
  /** The upstream branch was deleted on the remote. */
  gone: Schema.Boolean,
});
export type Upstream = typeof Upstream.Type;

export const Head = Schema.TaggedUnion({
  Branch: { name: ReportedText, upstream: Schema.NullOr(Upstream) },
  Detached: {},
  /** A branch with no commits yet. */
  Unborn: { name: ReportedText },
});
export type Head = typeof Head.Type;

export const Commit = Schema.Struct({
  sha: ReportedText,
  subject: ReportedText,
  committedAt: Schema.DateTimeUtc,
});
export type Commit = typeof Commit.Type;

/** Where a local branch's newest commit is, which says what deleting the branch would lose. */
export const BranchTip = Schema.Struct({
  sha: ReportedText,
  subject: ReportedText,
  committedAt: Schema.DateTimeUtc,
  /** The tip is in the default branch as last fetched from `origin`. */
  merged: Schema.Boolean,
  /** The tip is in some remote-tracking branch, so every commit is on a remote. */
  pushed: Schema.Boolean,
  /** Commits in no remote-tracking branch, which exist only on this machine. */
  localCommits: Count,
});
export type BranchTip = typeof BranchTip.Type;

export const LocalBranch = Schema.Struct({
  name: ReportedText,
  upstream: Schema.NullOr(Upstream),
  /** Null from agents that predate reporting it. */
  tip: Schema.NullOr(BranchTip).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(null))),
});
export type LocalBranch = typeof LocalBranch.Type;

export const Stash = Schema.Struct({
  index: Count,
  message: ReportedText,
  /** The stash's commit. Null from agents that predate reporting it. */
  sha: Schema.NullOr(ReportedText).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(null))),
});
export type Stash = typeof Stash.Type;

/** A Git operation stopped part-way, waiting for the developer to continue or abort it. */
export const Operation = Schema.Literals(["merge", "rebase", "cherry-pick", "revert", "bisect"]);
export type Operation = typeof Operation.Type;

/**
 * A branch FleetFrog deleted, kept in `ref` so it can be restored until the trash is emptied.
 * Refs are shared by every worktree of a clone, so only the main worktree reports them.
 */
export const DeletedBranch = Schema.Struct({
  name: ReportedText,
  /** `refs/fleetfrog/deleted/<epoch milliseconds>/<name>`. */
  ref: ReportedText,
  sha: ReportedText,
  subject: ReportedText,
  deletedAt: Schema.DateTimeUtc,
});
export type DeletedBranch = typeof DeletedBranch.Type;

/**
 * A stash FleetFrog dropped, kept in `ref` so it can be restored until the trash is emptied. Only
 * the main worktree reports them.
 */
export const DroppedStash = Schema.Struct({
  /** `refs/fleetfrog/stashes/<epoch milliseconds>/<index>`. */
  ref: ReportedText,
  sha: ReportedText,
  /** The stash's message, such as `On main: half-done refactor`. */
  message: ReportedText,
  droppedAt: Schema.DateTimeUtc,
});
export type DroppedStash = typeof DroppedStash.Type;

/** Where FleetFrog keeps the stashes it drops. */
export const droppedStashPrefix = "refs/fleetfrog/stashes/";

const droppedStashPattern = /^refs\/fleetfrog\/stashes\/(\d+)\/\d+$/;

/** When a dropped-stash ref was dropped, or null for any other ref. */
export function parseDroppedStashRef(ref: string): { readonly droppedAtMillis: number } | null {
  const match = droppedStashPattern.exec(ref);

  return match?.[1] === undefined ? null : { droppedAtMillis: Number(match[1]) };
}

/**
 * A linked worktree of a clone, as its main worktree lists it. `Missing` means its folder is gone,
 * and `Broken` that its folder no longer links back to this clone, such as after the clone moved.
 */
export const LinkedWorktree = Schema.Struct({
  path: ReportedText,
  branch: Schema.NullOr(ReportedText),
  state: Schema.Literals(["Present", "Missing", "Broken"]),
});
export type LinkedWorktree = typeof LinkedWorktree.Type;

/** Where FleetFrog keeps the branches it deletes. */
export const deletedBranchPrefix = "refs/fleetfrog/deleted/";

const deletedRefPattern = /^refs\/fleetfrog\/deleted\/(\d+)\/(.+)$/;

/** The branch a deleted-branch ref keeps and when it was deleted, or null for any other ref. */
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
  /** Null when no operation is in progress, and from agents that predate reporting it. */
  operation: Schema.NullOr(Operation).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(null))),
  lastCommit: Schema.NullOr(Commit),
  changed: Capped(ChangedFile),
  untracked: Capped(ReportedText),
  stashes: Capped(Stash),
  branches: Capped(LocalBranch),
  /** The branch `origin/HEAD` points at, or null when the clone doesn't record one. */
  defaultBranch: Schema.NullOr(ReportedText).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(null)),
  ),
  deletedBranches: Capped(DeletedBranch).pipe(Schema.withDecodingDefaultTypeKey(noneYet)),
  droppedStashes: Capped(DroppedStash).pipe(Schema.withDecodingDefaultTypeKey(noneYet)),
  /** The clone's linked worktrees, reported only by its main worktree. */
  worktrees: ReportedList(LinkedWorktree).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed([])),
  ),
  /** When this checkout last fetched, from the modification time of `FETCH_HEAD`. */
  lastFetchedAt: Schema.NullOr(Schema.DateTimeUtc),
});
export type GitStatus = typeof GitStatus.Type;

/** A merged pull request from a local branch, with the commit it was merged at. */
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

/** Remote state read through the GitHub CLI without fetching into the checkout. */
export const GithubState = Schema.Struct({
  defaultBranch: ReportedText,
  /** The default branch's head on GitHub. */
  remoteSha: ReportedText,
  /** The local remote-tracking ref for the default branch, when present. */
  trackingSha: Schema.NullOr(ReportedText),
  pullRequests: ReportedList(PullRequest),
  /** Recently merged pull requests from branches that still exist locally. */
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

/** Where a checkout is kept: with the projects the agent watches, or in the Archive folder. */
export const Placement = Schema.TaggedUnion({
  Projects: {},
  Archive: {
    /** Where FleetFrog moved it from, or null for a checkout put in the archive by hand. */
    originalPath: Schema.NullOr(ReportedText),
    archivedAt: Schema.NullOr(Schema.DateTimeUtc),
  },
});
export type Placement = typeof Placement.Type;

/** One working tree on one machine, as last observed by its agent. */
export const Checkout = Schema.Struct({
  path: ReportedText,
  identity: RepositoryIdentity,
  /**
   * The `origin` URL that other machines clone from, with any credentials removed. Null without an
   * HTTPS or SSH origin, and from agents that predate cloning.
   */
  originUrl: Schema.NullOr(ReportedText).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(null)),
  ),
  /** The main worktree's directory name, used when the identity has no readable name. */
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

/**
 * The main worktree of the clone this checkout belongs to. Worktrees of one clone share its refs;
 * separate clones of the same repository don't.
 */
export function clonePath(checkout: Pick<Checkout, "path" | "worktree">): string {
  return checkout.worktree._tag === "Main" ? checkout.path : checkout.worktree.mainPath;
}
