import { Effect, Schema } from "effect";

import { Operation } from "./checkout.ts";
import { Count } from "./count.ts";

/**
 * A group of actions that a machine's owner allows or denies on that machine, with
 * `fleetfrog allow` and `fleetfrog deny`. The hub can see the policy but never change it. `git`
 * covers fetching, pulling, cloning, switching branches and stashing, and creating the project
 * folders that clones go into. `cleanup` covers actions that remove things from where the
 * developer works, even though each can be undone until the trash is emptied.
 */
export const Tier = Schema.Literals(["git", "cleanup"]);
export type Tier = typeof Tier.Type;

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
  /** Switches the checkout at `path` to the local branch `branch`, if it has no changes. */
  Switch: { path: Schema.String, branch: Schema.String },
  /** Stashes every change in the checkout at `path`, including untracked files. */
  Stash: { path: Schema.String },
});
export type ActionRequest = typeof ActionRequest.Type;

export const ActionKind = Schema.Literals(["Fetch", "Pull", "Clone", "Switch", "Stash"]);
export type ActionKind = typeof ActionKind.Type;

export const actionTiers = {
  Fetch: "git",
  Pull: "git",
  Clone: "git",
  Switch: "git",
  Stash: "git",
} as const satisfies Record<ActionRequest["_tag"], Tier>;

/** Actions the dashboard addresses to one target each, rather than to a scope the hub expands. */
export const TargetedRequest = Schema.Union([
  ActionRequest.cases.Switch,
  ActionRequest.cases.Stash,
]);
export type TargetedRequest = typeof TargetedRequest.Type;

/** What a connected agent can run and what its owner allows. */
export const AgentCapabilities = Schema.Struct({
  actions: Schema.Array(ActionKind),
  allowedTiers: Schema.Array(Tier),
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
  Switched: { branch: Schema.String },
  Stashed: { files: Count },
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
