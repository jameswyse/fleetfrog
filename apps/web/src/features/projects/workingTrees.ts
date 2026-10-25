import { clonePath } from "@fleetfrog/protocol/domain/checkout";

import { mergeProof } from "../branches/branchTidying.ts";
import { busyThreads, threadsAt } from "../t3Code/t3CodeLookup.ts";
import { conflictedFiles } from "./checkoutSummary.ts";

import type {
  Checkout,
  GitStatus,
  LinkedWorktree,
  LocalBranch,
  Operation,
} from "@fleetfrog/protocol/domain/checkout";
import type { Machine, MachineCheckout } from "@fleetfrog/protocol/domain/fleet";

import type { MergeProof } from "../branches/branchTidying.ts";

export type WorkingTreeLifecycle =
  | { readonly _tag: "Active" }
  | { readonly _tag: "Finished"; readonly pullRequest: number | null }
  | { readonly _tag: "RemoteGone" };

export type WorkingTreeProblem =
  | { readonly _tag: "Unreadable"; readonly message: string }
  | { readonly _tag: "Conflicts"; readonly files: number }
  | { readonly _tag: "Operation"; readonly operation: Operation };

export interface WorkingTree {
  readonly kind: "Main" | "Linked";
  readonly path: string;
  readonly entry: MachineCheckout | null;
  readonly git: GitStatus | null;
  readonly branch: string | null;
  readonly presence: LinkedWorktree["state"];
  readonly merge: MergeProof | null;
  readonly problem: WorkingTreeProblem | null;
  readonly lifecycle: WorkingTreeLifecycle;
  readonly lastActive: number;
}

export interface CloneOutline {
  readonly path: string;
  readonly main: WorkingTree | null;
  readonly linked: ReadonlyArray<WorkingTree>;
  readonly anchor: { readonly checkout: Checkout; readonly git: GitStatus } | null;
  readonly parked: ReadonlyArray<LocalBranch>;
  readonly unreportedBranches: number;
}

const active: WorkingTreeLifecycle = { _tag: "Active" };

function gitOf(checkout: Checkout): GitStatus | null {
  return checkout.status._tag === "Read" ? checkout.status.git : null;
}

function problemOf(checkout: Checkout): WorkingTreeProblem | null {
  if (checkout.status._tag === "Failed") {
    return { _tag: "Unreadable", message: checkout.status.message };
  }

  const { git } = checkout.status;
  const files = conflictedFiles(git);

  if (files > 0) {
    return { _tag: "Conflicts", files };
  }

  return git.operation === null ? null : { _tag: "Operation", operation: git.operation };
}

function lifecycleOf(options: {
  readonly machine: Machine;
  readonly checkout: Checkout;
  readonly merge: MergeProof | null;
  readonly ignoredBranches: ReadonlyArray<string>;
}): WorkingTreeLifecycle {
  const { checkout, merge } = options;
  const git = gitOf(checkout);

  if (git === null || git.head._tag !== "Branch") {
    return active;
  }

  const { name, upstream } = git.head;
  const defaultBranch = git.defaultBranch ?? checkout.github?.defaultBranch ?? null;

  const settled =
    name !== defaultBranch &&
    !options.ignoredBranches.includes(name) &&
    git.changed.total + git.untracked.total === 0 &&
    git.operation === null &&
    busyThreads(options.machine, [checkout.path]).length === 0;

  if (!settled) {
    return active;
  }

  if (merge !== null) {
    return {
      _tag: "Finished",
      pullRequest: merge._tag === "PullRequest" ? merge.pullRequest.number : null,
    };
  }

  return upstream?.gone === true ? { _tag: "RemoteGone" } : active;
}

function lastActiveAt(machine: Machine, checkout: Checkout): number {
  return Math.max(
    gitOf(checkout)?.lastCommit?.committedAt.epochMilliseconds ?? 0,
    ...threadsAt(machine, checkout.path).map(({ updatedAt }) => updatedAt.epochMilliseconds),
  );
}

function listedTree(options: {
  readonly machine: Machine;
  readonly entry: MachineCheckout;
  readonly presence: LinkedWorktree["state"];
  readonly ignoredBranches: ReadonlyArray<string>;
}): WorkingTree {
  const { checkout } = options.entry;
  const git = gitOf(checkout);
  const merge = mergeProof(checkout);
  const kind = checkout.worktree._tag;

  return {
    kind,
    path: checkout.path,
    entry: options.entry,
    git,
    branch: git === null || git.head._tag === "Detached" ? null : git.head.name,
    presence: options.presence,
    merge,
    problem: problemOf(checkout),
    lifecycle:
      kind === "Linked"
        ? lifecycleOf({
            machine: options.machine,
            checkout,
            merge,
            ignoredBranches: options.ignoredBranches,
          })
        : active,
    lastActive: lastActiveAt(options.machine, checkout),
  };
}

function outlineClone(options: {
  readonly machine: Machine;
  readonly path: string;
  readonly entries: ReadonlyArray<MachineCheckout>;
  readonly ignoredBranches: ReadonlyArray<string>;
}): CloneOutline {
  const { machine, ignoredBranches } = options;
  const mainEntry = options.entries.find(({ checkout }) => checkout.worktree._tag === "Main");
  const reported = mainEntry === undefined ? [] : (gitOf(mainEntry.checkout)?.worktrees ?? []);

  const linkedEntries = options.entries.filter(
    ({ checkout }) => checkout.worktree._tag === "Linked",
  );

  const listed = linkedEntries.map((entry) =>
    listedTree({
      machine,
      entry,
      presence: reported.find(({ path }) => path === entry.checkout.path)?.state ?? "Present",
      ignoredBranches,
    }),
  );

  const unlisted = reported
    .filter(({ path }) => !linkedEntries.some(({ checkout }) => checkout.path === path))
    .map((worktree): WorkingTree => ({
      kind: "Linked",
      path: worktree.path,
      entry: null,
      git: null,
      branch: worktree.branch,
      presence: worktree.state,
      merge: null,
      problem: null,
      lifecycle: active,
      lastActive: 0,
    }));

  const main =
    mainEntry === undefined
      ? null
      : listedTree({ machine, entry: mainEntry, presence: "Present", ignoredBranches });

  const linked = [...listed, ...unlisted].toSorted(
    (left, right) => right.lastActive - left.lastActive,
  );

  const trees = main === null ? linked : [main, ...linked];

  const [anchor] = trees.flatMap(({ entry, git }) =>
    entry === null || git === null ? [] : [{ checkout: entry.checkout, git }],
  );

  const checkedOut = new Set(trees.flatMap(({ branch }) => (branch === null ? [] : [branch])));
  const branches = anchor?.git.branches;

  return {
    path: options.path,
    main,
    linked,
    anchor: anchor ?? null,
    parked: branches?.items.filter(({ name }) => !checkedOut.has(name)) ?? [],
    unreportedBranches: branches === undefined ? 0 : branches.total - branches.items.length,
  };
}

export function outlineCell(options: {
  readonly machine: Machine;
  readonly entries: ReadonlyArray<MachineCheckout>;
  readonly ignoredBranches: ReadonlyArray<string>;
}): ReadonlyArray<CloneOutline> {
  const clones = Map.groupBy(options.entries, ({ checkout }) => clonePath(checkout));

  return Array.from(clones, ([path, entries]) =>
    outlineClone({
      machine: options.machine,
      path,
      entries,
      ignoredBranches: options.ignoredBranches,
    }),
  );
}

export function workingTreesOf(clone: CloneOutline): ReadonlyArray<WorkingTree> {
  return clone.main === null ? clone.linked : [clone.main, ...clone.linked];
}
