import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { Effect, Option } from "effect";

import { ActionOutcome, ActionResult } from "@fleetfrog/protocol/domain/action";
import { checkCloneDestination, expandHome } from "@fleetfrog/protocol/domain/cloneDestination";
import { pullBlocker } from "@fleetfrog/protocol/domain/pullEligibility";

import { isMissingFile } from "../config/agentConfig.ts";
import { readGitStatus } from "../git/readCheckout.ts";
import { cloneableUrl } from "../git/remoteIdentity.ts";
import { runGitAction } from "../process/runTool.ts";

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
export const pullCheckout = (location: CheckoutLocation, output: ActionOutput) =>
  Effect.gen(function* () {
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
  }).pipe(Effect.catchTag("CommandFailed", failedWith));

/** Why a clone destination was refused, for each way it can fail the path checks. */
export const destinationProblems = {
  NotAbsolute: "The destination must be an absolute path or start with ~.",
  Hidden: "The destination can't be in a hidden folder or contain . or .. segments.",
  OutsideRoots: "The destination must be inside one of this machine's project folders.",
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
  });

  return resolved._tag === "Valid" ? null : destinationProblems[resolved._tag];
}

/**
 * Clones a remote into a new folder inside a discovery folder, checking out its default branch.
 * The destination has already passed the path checks.
 */
export const cloneRepository = (
  options: {
    readonly url: string;
    readonly destination: Extract<DestinationCheck, { _tag: "Valid" }>;
    readonly home: string;
  },
  output: ActionOutput,
) =>
  Effect.gen(function* () {
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
  }).pipe(Effect.catchTag("CommandFailed", failedWith));
