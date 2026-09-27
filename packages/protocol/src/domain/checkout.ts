import { Effect, Schema } from "effect";

import { Count } from "./count.ts";
import { RepositoryIdentity } from "./repositoryIdentity.ts";

/** Git's porcelain status letters for one side (index or worktree) of a changed path. */
export const FileState = Schema.Literals([".", "M", "T", "A", "D", "R", "C", "U"]);
export type FileState = typeof FileState.Type;

export const ChangedFile = Schema.Struct({
  path: Schema.String,
  /** The path before a rename or copy. */
  originalPath: Schema.NullOr(Schema.String),
  staged: FileState,
  unstaged: FileState,
});
export type ChangedFile = typeof ChangedFile.Type;

/** A list truncated to a fixed length, with the full count kept so the dashboard can say "and N more". */
function Capped<S extends Schema.Top>(item: S) {
  return Schema.Struct({ items: Schema.Array(item), total: Count });
}

export const Upstream = Schema.Struct({
  name: Schema.String,
  ahead: Count,
  behind: Count,
  /** The upstream branch was deleted on the remote. */
  gone: Schema.Boolean,
});
export type Upstream = typeof Upstream.Type;

export const Head = Schema.TaggedUnion({
  Branch: { name: Schema.String, upstream: Schema.NullOr(Upstream) },
  Detached: {},
  /** A branch with no commits yet. */
  Unborn: { name: Schema.String },
});
export type Head = typeof Head.Type;

export const Commit = Schema.Struct({
  sha: Schema.String,
  subject: Schema.String,
  committedAt: Schema.DateTimeUtc,
});
export type Commit = typeof Commit.Type;

export const LocalBranch = Schema.Struct({
  name: Schema.String,
  upstream: Schema.NullOr(Upstream),
});
export type LocalBranch = typeof LocalBranch.Type;

export const Stash = Schema.Struct({
  index: Count,
  message: Schema.String,
});
export type Stash = typeof Stash.Type;

/** A Git operation stopped part-way, waiting for the developer to continue or abort it. */
export const Operation = Schema.Literals(["merge", "rebase", "cherry-pick", "revert", "bisect"]);
export type Operation = typeof Operation.Type;

export const GitStatus = Schema.Struct({
  head: Head,
  /** Null when no operation is in progress, and from agents that predate reporting it. */
  operation: Schema.NullOr(Operation).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(null))),
  lastCommit: Schema.NullOr(Commit),
  changed: Capped(ChangedFile),
  untracked: Capped(Schema.String),
  stashes: Capped(Stash),
  branches: Capped(LocalBranch),
  /** When this checkout last fetched, from the modification time of `FETCH_HEAD`. */
  lastFetchedAt: Schema.NullOr(Schema.DateTimeUtc),
});
export type GitStatus = typeof GitStatus.Type;

export const PullRequest = Schema.Struct({
  number: Count,
  title: Schema.String,
  url: Schema.String,
  branch: Schema.String,
  draft: Schema.Boolean,
});
export type PullRequest = typeof PullRequest.Type;

/** Remote state read through the GitHub CLI without fetching into the checkout. */
export const GithubState = Schema.Struct({
  defaultBranch: Schema.String,
  /** The default branch's head on GitHub. */
  remoteSha: Schema.String,
  /** The local remote-tracking ref for the default branch, when present. */
  trackingSha: Schema.NullOr(Schema.String),
  pullRequests: Schema.Array(PullRequest),
  checkedAt: Schema.DateTimeUtc,
});
export type GithubState = typeof GithubState.Type;

export const CheckoutStatus = Schema.TaggedUnion({
  Read: { git: GitStatus },
  Failed: { message: Schema.String },
});
export type CheckoutStatus = typeof CheckoutStatus.Type;

export const Worktree = Schema.TaggedUnion({
  Main: {},
  Linked: { mainPath: Schema.String },
});
export type Worktree = typeof Worktree.Type;

/** One working tree on one machine, as last observed by its agent. */
export const Checkout = Schema.Struct({
  path: Schema.String,
  identity: RepositoryIdentity,
  /**
   * The `origin` URL that other machines clone from, with any credentials removed. Null without an
   * HTTPS or SSH origin, and from agents that predate cloning.
   */
  originUrl: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(null)),
  ),
  /** The main worktree's directory name, used when the identity has no readable name. */
  directoryName: Schema.String,
  worktree: Worktree,
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
