import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { DateTime, Effect, Option } from "effect";

import { ActionOutcome, ActionResult, SkipReason } from "@fleetfrog/protocol/domain/action";
import { deletedBranchPrefix, parseDeletedRef } from "@fleetfrog/protocol/domain/checkout";
import { checkCloneDestination, expandHome } from "@fleetfrog/protocol/domain/cloneDestination";
import { pullBlocker } from "@fleetfrog/protocol/domain/pullEligibility";
import { stashBlocker } from "@fleetfrog/protocol/domain/stashEligibility";
import { switchBlocker } from "@fleetfrog/protocol/domain/switchEligibility";

import { isMissingFile } from "../config/agentConfig.ts";
import { readGitStatus } from "../git/readCheckout.ts";
import { cloneableUrl } from "../git/remoteIdentity.ts";
import { runGit, runGitAction } from "../process/runTool.ts";

import type { BranchAtCommit } from "@fleetfrog/protocol/domain/action";
import type { DestinationCheck } from "@fleetfrog/protocol/domain/cloneDestination";

import type { CheckoutLocation } from "../git/readCheckout.ts";
import type { CommandFailed } from "../process/runTool.ts";
import type { ActionOutput } from "./actionOutput.ts";

const failed = (message: string) => ActionOutcome.cases.Failed.make({ message });
const succeeded = (result: ActionResult) => ActionOutcome.cases.Succeeded.make({ result });
const failedWith = ({ message }: CommandFailed) => Effect.succeed(failed(message));

const fetchAll = (location: CheckoutLocation, output: ActionOutput) =>
  runGitAction({
    cwd: location.path,
    // Tags stay, even where the user's configuration would prune them.
    args: ["fetch", "--all", "--prune", "--no-prune-tags", "--progress"],
    onOutput: output.write,
  });

/** Fetches every remote of the repository. Worktrees share remote-tracking refs, so one is enough. */
export const fetchRepository = (location: CheckoutLocation, output: ActionOutput) =>
  fetchAll(location, output).pipe(
    Effect.as(succeeded(ActionResult.cases.Fetched.make({}))),
    Effect.catchTag("CommandFailed", failedWith),
  );

/**
 * Fetches and fast-forwards the checked-out branch. The checkout's state is checked before the
 * fetch and again after it, so changes made meanwhile still stop the pull.
 */
export const pullCheckout = Effect.fn("pullCheckout")(
  function* (location: CheckoutLocation, output: ActionOutput) {
    const before = pullBlocker(yield* readGitStatus(location));

    if (before !== null) {
      return ActionOutcome.cases.Skipped.make({ reason: before });
    }

    yield* fetchAll(location, output);

    const git = yield* readGitStatus(location);
    const after = pullBlocker(git);

    if (after !== null) {
      return ActionOutcome.cases.Skipped.make({ reason: after });
    }

    const behind = git.head._tag === "Branch" ? (git.head.upstream?.behind ?? 0) : 0;

    if (behind === 0) {
      return succeeded(ActionResult.cases.UpToDate.make({}));
    }

    // Git also refuses if the merge would overwrite an untracked file or a change made just now.
    yield* runGitAction({
      cwd: location.path,
      args: ["merge", "--ff-only", "@{upstream}"],
      onOutput: output.write,
    });

    return succeeded(ActionResult.cases.FastForwarded.make({ commits: behind }));
  },
  Effect.catchTag("CommandFailed", failedWith),
);

const skipped = (reason: SkipReason) => ActionOutcome.cases.Skipped.make({ reason });

/** The commit a ref points at, or null when there is no such ref. */
const refCommit = (location: CheckoutLocation, ref: string) =>
  runGit(location.path, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).pipe(
    Effect.map((output): string | null => output.trim()),
    Effect.orElseSucceed(() => null),
  );

/** The branch `origin/HEAD` points at, which is never deleted. */
const defaultBranchOf = (location: CheckoutLocation) =>
  runGit(location.path, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]).pipe(
    Effect.map((ref): string | null => ref.trim().replace(/^refs\/remotes\/origin\//, "")),
    Effect.orElseSucceed(() => null),
  );

/** Files in a worktree's Git directory naming a branch an operation is part-way through. */
const operationBranchFiles = [
  path.join("rebase-merge", "head-name"),
  path.join("rebase-apply", "head-name"),
  "BISECT_START",
];

/**
 * The branches any worktree of the repository has checked out, this one included, or is part-way
 * through rebasing or bisecting, when HEAD is detached but the branch is still in use.
 */
const branchesInUse = (location: CheckoutLocation) =>
  Effect.gen(function* () {
    const listing = yield* runGit(location.path, ["worktree", "list", "--porcelain"]);
    const checkedOut = listing
      .split("\n")
      .filter((line) => line.startsWith("branch refs/heads/"))
      .map((line) => line.slice("branch refs/heads/".length));
    const linked = yield* Effect.promise(() =>
      readdir(path.join(location.commonDirectory, "worktrees")).catch(() => []),
    );
    const gitDirectories = [
      location.commonDirectory,
      ...linked.map((name) => path.join(location.commonDirectory, "worktrees", name)),
    ];
    const operating = yield* Effect.promise(() =>
      Promise.all(
        gitDirectories.flatMap((directory) =>
          operationBranchFiles.map((file) =>
            readFile(path.join(directory, file), "utf8").then(
              (text) => text.trim().replace(/^refs\/heads\//, ""),
              () => "",
            ),
          ),
        ),
      ),
    );

    return new Set([...checkedOut, ...operating.filter((name) => name !== "")]);
  });

/** Whether Git accepts `name` as a branch name, so it can't be read as anything else. */
const isBranchName = (location: CheckoutLocation, name: string) =>
  runGit(location.path, ["check-ref-format", `refs/heads/${name}`]).pipe(
    Effect.as(!name.startsWith("-")),
    Effect.orElseSucceed(() => false),
  );

/**
 * Switches the checkout to one of its local branches. The checkout must have no changes to tracked
 * files, so none are carried across, and the branch must not be checked out in another worktree.
 */
export const switchBranch = Effect.fn("switchBranch")(
  function* (location: CheckoutLocation, branch: string, output: ActionOutput) {
    const blocker = switchBlocker(yield* readGitStatus(location), branch);

    if (blocker !== null) {
      return skipped(blocker);
    }

    const exists =
      (yield* isBranchName(location, branch)) &&
      (yield* refCommit(location, `refs/heads/${branch}`)) !== null;

    if (!exists) {
      return skipped(SkipReason.cases.NoSuchBranch.make({}));
    }

    if ((yield* branchesInUse(location)).has(branch)) {
      return skipped(SkipReason.cases.BranchInUse.make({}));
    }

    yield* runGitAction({
      cwd: location.path,
      args: ["switch", "--no-guess", branch],
      onOutput: output.write,
    });

    return succeeded(ActionResult.cases.Switched.make({ branch }));
  },
  Effect.catchTag("CommandFailed", failedWith),
);

/** A time such as 27/09/2026 14:05 in the machine's own time zone, for a stash message. */
function stashDate(now: DateTime.Utc): string {
  const parts = DateTime.toParts(DateTime.setZone(now, DateTime.zoneMakeLocal()));
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${pad(parts.day)}/${pad(parts.month)}/${parts.year} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

/**
 * Stashes every change, untracked files included, so the working tree is clean and the changes can
 * be brought back with `git stash pop`. Ignored files stay where they are.
 */
export const stashChanges = Effect.fn("stashChanges")(
  function* (location: CheckoutLocation, output: ActionOutput) {
    const git = yield* readGitStatus(location);
    const blocker = stashBlocker(git);

    if (blocker !== null) {
      return skipped(blocker);
    }

    yield* runGitAction({
      cwd: location.path,
      args: [
        "stash",
        "push",
        "--include-untracked",
        "--message",
        `Stashed from FleetFrog on ${stashDate(yield* DateTime.now)}`,
      ],
      onOutput: output.write,
    });

    return succeeded(
      ActionResult.cases.Stashed.make({ files: git.changed.total + git.untracked.total }),
    );
  },
  Effect.catchTag("CommandFailed", failedWith),
);

/** Why a clone destination was refused, for each way it can fail the path checks. */
export const destinationProblems = {
  NotAbsolute: "The destination must be an absolute path or start with ~.",
  Hidden: "The destination can't be in a hidden folder or contain . or .. segments.",
  OutsideRoots: "The destination must be inside one of this machine's project folders.",
  InArchive: "The destination can't be in the Archive folder.",
} satisfies Record<Exclude<DestinationCheck["_tag"], "Valid">, string>;

/** The path with every existing ancestor's symbolic links resolved. */
async function resolveExisting(target: string): Promise<string> {
  const missing: Array<string> = [];
  let existing = target;

  for (;;) {
    try {
      return path.join(await realpath(existing), ...missing.toReversed());
    } catch (error) {
      if (!isMissingFile(error) || path.dirname(existing) === existing) {
        throw error;
      }

      missing.push(path.basename(existing));
      existing = path.dirname(existing);
    }
  }
}

/**
 * Why a destination that passed the path checks still can't be cloned into, or null when it can.
 * Its discovery folder must exist, it must not, and with symbolic links resolved it must still
 * pass the path checks, so a link can't lead the clone elsewhere.
 */
async function destinationProblem(options: {
  readonly target: string;
  readonly root: string;
  readonly home: string;
  readonly archive: string | null;
}): Promise<string | null> {
  const rootStat = await stat(options.root).catch(() => null);

  if (rootStat === null || !rootStat.isDirectory()) {
    return `The project folder ${options.root} doesn't exist on this machine.`;
  }

  if (
    await lstat(options.target).then(
      () => true,
      () => false,
    )
  ) {
    return `${options.target} already exists.`;
  }

  const resolved = checkCloneDestination({
    destination: await resolveExisting(options.target),
    home: options.home,
    roots: [await realpath(options.root)],
    archive: options.archive,
  });

  return resolved._tag === "Valid" ? null : destinationProblems[resolved._tag];
}

/**
 * Clones a remote into a new folder inside a discovery folder, checking out its default branch.
 * The destination has already passed the path checks.
 */
export const cloneRepository = Effect.fn("cloneRepository")(
  function* (
    options: {
      readonly url: string;
      readonly destination: Extract<DestinationCheck, { _tag: "Valid" }>;
      readonly home: string;
      readonly archive: string | null;
    },
    output: ActionOutput,
  ) {
    const url = cloneableUrl(options.url);

    // The URL must already be in the shared form, so nothing else is quietly rewritten.
    if (Option.isNone(url) || url.value !== options.url) {
      return failed("Only HTTPS and SSH remotes without credentials can be cloned.");
    }

    const { path: target, root } = options.destination;
    const problem = yield* Effect.promise(() =>
      destinationProblem({
        target,
        root: expandHome(root, options.home),
        home: options.home,
        archive: options.archive,
      }).catch((error: unknown) => `Couldn't check the destination: ${String(error)}`),
    );

    if (problem !== null) {
      return failed(problem);
    }

    yield* runGitAction({
      cwd: options.home,
      args: ["clone", "--progress", "--", options.url, target],
      // Only the transports the URL check allows, including for anything the clone fetches.
      environment: { GIT_ALLOW_PROTOCOL: "https:ssh" },
      onOutput: output.write,
    });

    return succeeded(ActionResult.cases.Cloned.make({}));
  },
  Effect.catchTag("CommandFailed", failedWith),
);

/**
 * Moves branches to the trash: each is kept as `refs/fleetfrog/deleted/<time>/<name>` and removed
 * from `refs/heads` in one transaction, which Git applies only if every branch still points at the
 * commit the dashboard showed. A branch that moved, is checked out or is the default branch stops
 * the whole request, so nothing changes.
 */
export const deleteBranches = Effect.fn("deleteBranches")(
  function* (
    location: CheckoutLocation,
    branches: ReadonlyArray<BranchAtCommit>,
    output: ActionOutput,
  ) {
    const inUse = yield* branchesInUse(location);
    const defaultBranch = yield* defaultBranchOf(location);

    for (const { name, sha } of branches) {
      if (!(yield* isBranchName(location, name))) {
        return skipped(SkipReason.cases.NoSuchBranch.make({}));
      }

      if (name === defaultBranch) {
        return skipped(SkipReason.cases.DefaultBranch.make({ branch: name }));
      }

      if (inUse.has(name)) {
        return skipped(SkipReason.cases.BranchCheckedOut.make({ branch: name }));
      }

      if ((yield* refCommit(location, `refs/heads/${name}`)) !== sha) {
        return skipped(SkipReason.cases.BranchChanged.make({ branch: name }));
      }
    }

    const deletedAt = DateTime.toEpochMillis(yield* DateTime.now);

    yield* runGitAction({
      cwd: location.path,
      args: ["update-ref", "--stdin"],
      input: branches
        .flatMap(({ name, sha }) => [
          `create ${deletedBranchPrefix}${deletedAt}/${name} ${sha}`,
          `delete refs/heads/${name} ${sha}`,
        ])
        .join("\n")
        .concat("\n"),
      onOutput: output.write,
    });

    // The branch's upstream and other settings go too, as `git branch -D` would remove them.
    yield* Effect.forEach(
      branches,
      ({ name }) =>
        runGit(location.path, ["config", "--remove-section", `branch.${name}`]).pipe(Effect.ignore),
      { discard: true },
    );

    return succeeded(ActionResult.cases.BranchesDeleted.make({ branches: branches.length }));
  },
  Effect.catchTag("CommandFailed", failedWith),
);

/** The branch a deleted-branch ref keeps, or null for any other ref. */
function deletedBranchName(ref: string): string | null {
  return parseDeletedRef(ref)?.name ?? null;
}

/** Recreates a deleted branch at its commit, unless a branch with its name exists now. */
export const restoreBranch = Effect.fn("restoreBranch")(
  function* (location: CheckoutLocation, ref: string, output: ActionOutput) {
    const name = deletedBranchName(ref);
    const sha = name === null ? null : yield* refCommit(location, ref);

    if (name === null || sha === null || !(yield* isBranchName(location, name))) {
      return skipped(SkipReason.cases.NotInTrash.make({}));
    }

    if ((yield* refCommit(location, `refs/heads/${name}`)) !== null) {
      return skipped(SkipReason.cases.BranchExists.make({ branch: name }));
    }

    yield* runGitAction({
      cwd: location.path,
      args: ["update-ref", "--stdin"],
      input: `create refs/heads/${name} ${sha}\ndelete ${ref} ${sha}\n`,
      onOutput: output.write,
    });

    return succeeded(ActionResult.cases.Restored.make({ path: null }));
  },
  Effect.catchTag("CommandFailed", failedWith),
);

/** Forgets a deleted branch. Its commits go once Git's garbage collection finds them unreachable. */
export const purgeBranch = Effect.fn("purgeBranch")(
  function* (location: CheckoutLocation, ref: string, output: ActionOutput) {
    const sha = deletedBranchName(ref) === null ? null : yield* refCommit(location, ref);

    if (sha === null) {
      return skipped(SkipReason.cases.NotInTrash.make({}));
    }

    yield* runGitAction({
      cwd: location.path,
      args: ["update-ref", "-d", ref, sha],
      onOutput: output.write,
    });

    return succeeded(ActionResult.cases.Purged.make({}));
  },
  Effect.catchTag("CommandFailed", failedWith),
);
