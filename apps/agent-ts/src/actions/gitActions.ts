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
import { listWorktrees } from "../git/worktrees.ts";
import { runGit, runGitAction } from "../process/runTool.ts";
import { keepDetachedCommits } from "./detachedCommits.ts";
import { failed, failedWith, skipped, succeeded } from "./outcomes.ts";

import type { BranchAtCommit } from "@fleetfrog/protocol/domain/action";
import type { DestinationCheck } from "@fleetfrog/protocol/domain/cloneDestination";

import type { CheckoutLocation } from "../git/readCheckout.ts";
import type { ActionOutput } from "./actionOutput.ts";

const fetchAll = (location: CheckoutLocation, output: ActionOutput) =>
  runGitAction({
    cwd: location.path,
    args: ["fetch", "--all", "--prune", "--no-prune-tags", "--progress"],
    onOutput: output.write,
  });

export const fetchRepository = (location: CheckoutLocation, output: ActionOutput) =>
  fetchAll(location, output).pipe(
    Effect.as(succeeded(ActionResult.cases.Fetched.make({}))),
    Effect.catchTag("CommandFailed", failedWith),
  );

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

    yield* runGitAction({
      cwd: location.path,
      args: ["merge", "--ff-only", "@{upstream}"],
      onOutput: output.write,
    });

    return succeeded(ActionResult.cases.FastForwarded.make({ commits: behind }));
  },
  Effect.catchTag("CommandFailed", failedWith),
);

export const refCommit = (location: CheckoutLocation, ref: string) =>
  runGit(location.path, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).pipe(
    Effect.map((output): string | null => output.trim()),
    Effect.orElseSucceed(() => null),
  );

const operationBranchFiles = [
  path.join("rebase-merge", "head-name"),
  path.join("rebase-apply", "head-name"),
  "BISECT_START",
];

const branchesInUse = (location: CheckoutLocation) =>
  Effect.gen(function* () {
    const checkedOut = (yield* listWorktrees(location.path)).flatMap(({ branch }) =>
      branch === null ? [] : [branch],
    );

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

const isBranchName = (location: CheckoutLocation, name: string) =>
  runGit(location.path, ["check-ref-format", `refs/heads/${name}`]).pipe(
    Effect.as(!name.startsWith("-")),
    Effect.orElseSucceed(() => false),
  );

export function stashDate(now: DateTime.Utc): string {
  const parts = DateTime.toParts(DateTime.setZone(now, DateTime.zoneMakeLocal()));
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${pad(parts.day)}/${pad(parts.month)}/${parts.year} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

export const switchBranch = Effect.fn("switchBranch")(
  function* (
    location: CheckoutLocation,
    options: { readonly branch: string; readonly stashChanges: boolean },
    output: ActionOutput,
  ) {
    const { branch } = options;
    const git = yield* readGitStatus(location);
    const blocker = switchBlocker(git, branch);

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

    const stashedFiles = git.changed.total;

    if (stashedFiles > 0) {
      if (!options.stashChanges) {
        return skipped(SkipReason.cases.UncommittedChanges.make({ files: stashedFiles }));
      }

      yield* runGitAction({
        cwd: location.path,
        args: [
          "stash",
          "push",
          "--message",
          `Stashed from FleetFrog before switching to ${branch} on ${stashDate(yield* DateTime.now)}`,
        ],
        onOutput: output.write,
      });
    }

    const savedCommits =
      git.head._tag === "Detached" ? yield* keepDetachedCommits(location.path, output) : 0;

    yield* runGitAction({
      cwd: location.path,
      args: ["switch", "--no-guess", branch],
      onOutput: output.write,
    });

    return succeeded(ActionResult.cases.Switched.make({ branch, stashedFiles, savedCommits }));
  },
  Effect.catchTag("CommandFailed", failedWith),
);

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

export const destinationProblems = {
  NotAbsolute: "The destination must be an absolute path or start with ~.",
  Hidden: "The destination can't be in a hidden folder or contain . or .. segments.",
  OutsideRoots: "The destination must be inside one of this machine's project folders.",
  InArchive: "The destination can't be in the Archive folder.",
} satisfies Record<Exclude<DestinationCheck["_tag"], "Valid">, string>;

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
      environment: { GIT_ALLOW_PROTOCOL: "https:ssh" },
      onOutput: output.write,
    });

    return succeeded(ActionResult.cases.Cloned.make({}));
  },
  Effect.catchTag("CommandFailed", failedWith),
);

const branchSkipReason = Effect.fn("branchSkipReason")(function* (options: {
  readonly location: CheckoutLocation;
  readonly name: string;
  readonly sha: string;
  readonly inUse: ReadonlySet<string>;
}) {
  const { location, name } = options;

  if (!(yield* isBranchName(location, name))) {
    return SkipReason.cases.NoSuchBranch.make({});
  }

  if (options.inUse.has(name)) {
    return SkipReason.cases.BranchCheckedOut.make({ branch: name });
  }

  return (yield* refCommit(location, `refs/heads/${name}`)) === options.sha
    ? null
    : SkipReason.cases.BranchChanged.make({ branch: name });
});

export const deleteBranches = Effect.fn("deleteBranches")(
  function* (
    location: CheckoutLocation,
    branches: ReadonlyArray<BranchAtCommit>,
    output: ActionOutput,
  ) {
    const inUse = yield* branchesInUse(location);
    const deletable: Array<BranchAtCommit> = [];
    const skippedBranches: Array<{ readonly branch: string; readonly reason: SkipReason }> = [];

    for (const { name, sha } of branches) {
      const reason = yield* branchSkipReason({ location, name, sha, inUse });

      if (reason === null) {
        deletable.push({ name, sha });
      } else {
        skippedBranches.push({ branch: name, reason });
      }
    }

    const [first] = skippedBranches;

    if (deletable.length === 0 && first !== undefined) {
      return skipped(first.reason);
    }

    const deletedAt = DateTime.toEpochMillis(yield* DateTime.now);

    yield* runGitAction({
      cwd: location.path,
      args: ["update-ref", "--stdin"],
      input: deletable
        .flatMap(({ name, sha }) => [
          `create ${deletedBranchPrefix}${deletedAt}/${name} ${sha}`,
          `delete refs/heads/${name} ${sha}`,
        ])
        .join("\n")
        .concat("\n"),
      onOutput: output.write,
    });

    yield* Effect.forEach(
      deletable,
      ({ name }) =>
        runGit(location.path, ["config", "--remove-section", `branch.${name}`]).pipe(Effect.ignore),
      { discard: true },
    );

    return succeeded(
      ActionResult.cases.BranchesDeleted.make({
        branches: deletable.length,
        skipped: skippedBranches,
      }),
    );
  },
  Effect.catchTag("CommandFailed", failedWith),
);

function deletedBranchName(ref: string): string | null {
  return parseDeletedRef(ref)?.name ?? null;
}

const freeBranchName = Effect.fn("freeBranchName")(function* (
  location: CheckoutLocation,
  name: string,
) {
  for (let attempt = 1; ; attempt += 1) {
    const candidate =
      attempt === 1 ? name : `${name}-restored${attempt === 2 ? "" : `-${attempt - 1}`}`;

    if ((yield* refCommit(location, `refs/heads/${candidate}`)) === null) {
      return candidate;
    }
  }
});

export const restoreBranch = Effect.fn("restoreBranch")(
  function* (location: CheckoutLocation, ref: string, output: ActionOutput) {
    const name = deletedBranchName(ref);
    const sha = name === null ? null : yield* refCommit(location, ref);

    if (name === null || sha === null || !(yield* isBranchName(location, name))) {
      return skipped(SkipReason.cases.NotInTrash.make({}));
    }

    const branch = yield* freeBranchName(location, name);

    yield* runGitAction({
      cwd: location.path,
      args: ["update-ref", "--stdin"],
      input: `create refs/heads/${branch} ${sha}\ndelete ${ref} ${sha}\n`,
      onOutput: output.write,
    });

    return succeeded(ActionResult.cases.Restored.make({ path: null, branch }));
  },
  Effect.catchTag("CommandFailed", failedWith),
);

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
