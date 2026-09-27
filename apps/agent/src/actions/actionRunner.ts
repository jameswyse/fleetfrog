import { homedir } from "node:os";

import { Duration, Effect, FiberMap, Semaphore } from "effect";

import {
  ActionOutcome,
  ActionRequest,
  ActionUpdate,
  SkipReason,
  TrashTarget,
  actionTiers,
} from "@fleetfrog/protocol/domain/action";
import { checkCloneDestination } from "@fleetfrog/protocol/domain/cloneDestination";
import { InspectionResult } from "@fleetfrog/protocol/domain/trash";

import { inspectCheckout } from "../inspect/inspectCheckout.ts";
import { makeActionOutput } from "./actionOutput.ts";
import { archiveCheckout, unarchiveCheckout } from "./archiveActions.ts";
import {
  cloneRepository,
  destinationProblems,
  fetchRepository,
  deleteBranches,
  pullCheckout,
  purgeBranch,
  restoreBranch,
  stashChanges,
  switchBranch,
} from "./gitActions.ts";
import { dropStashes, purgeStash, restoreStash } from "./stashActions.ts";
import { deleteCheckout, purgeCheckout, restoreCheckout, trashCheckout } from "./trashActions.ts";
import { removeWorktree } from "./worktreeActions.ts";

import type { Tier } from "@fleetfrog/protocol/domain/action";
import type { RunId } from "@fleetfrog/protocol/domain/activity";
import type { TrashId } from "@fleetfrog/protocol/domain/trash";

import type { AuditEntry } from "../audit/auditLog.ts";
import type { ConfigUnavailable } from "../config/agentConfig.ts";
import type { AgentPolicy } from "../config/agentPolicy.ts";
import type { CheckoutLocation } from "../git/readCheckout.ts";
import type { InspectionOptions } from "../inspect/inspectCheckout.ts";
import type { ActionOutput } from "./actionOutput.ts";
import type { Folders } from "./archiveActions.ts";

/** Fetches and clones that may use the network at once. */
const networkConcurrency = 4;
const progressInterval = Duration.seconds(1);

/** What an action needs from the scanner: the checkouts it knows and a way to report changes. */
interface CheckoutCatalogue {
  readonly locate: (path: string) => CheckoutLocation | undefined;
  readonly rescanRepository: (commonDirectory: string) => Effect.Effect<void, unknown>;
  readonly track: (path: string) => Effect.Effect<void, unknown>;
  readonly forget: (path: string) => Effect.Effect<void, unknown>;
  /** Sends the hub everything in the trash. */
  readonly reportTrash: Effect.Effect<void, unknown>;
}

type Network = "Network" | "Local";

/** An action resolved against this machine: what it locks, how it runs and what to rescan after. */
type Plan =
  /** Nothing on this machine matches the request, so it can't run at all. */
  | { readonly _tag: "Refused"; readonly message: string }
  | {
      readonly _tag: "Ready";
      readonly lockKey: string;
      /** Network actions wait for one of the slots that limit network use. */
      readonly network: Network;
      readonly perform: (output: ActionOutput) => Effect.Effect<ActionOutcome>;
      readonly afterwards: (outcome: ActionOutcome) => Effect.Effect<void, unknown>;
    };

/**
 * Runs the hub's action requests on this machine. Each action is checked against the owner's
 * policy when it arrives, waits for any other action on the same repository and, if it uses the
 * network, for a network slot, then reports its progress and outcome. Every step is recorded in the
 * audit log.
 */
export const makeActionRunner = Effect.fn("makeActionRunner")(function* (options: {
  readonly catalogue: CheckoutCatalogue;
  /**
   * The discovery folders and Archive folder the hub last configured. Clones must land inside a
   * discovery folder and outside the Archive folder.
   */
  readonly folders: () => Omit<Folders, "home">;
  /** Where trashed checkouts are kept. */
  readonly trashDirectory: string;
  readonly loadPolicy: Effect.Effect<AgentPolicy, ConfigUnavailable>;
  readonly report: (runId: RunId, update: ActionUpdate) => Effect.Effect<void, unknown>;
  readonly audit: (entry: AuditEntry) => Effect.Effect<void>;
}) {
  const fibers = yield* FiberMap.make<RunId>();
  const slots = yield* Semaphore.make(networkConcurrency);
  const repositoryLocks = new Map<string, Semaphore.Semaphore>();
  const cancelled = new Set<RunId>();
  const home = homedir();

  const lockFor = (key: string) => {
    const existing = repositoryLocks.get(key);

    if (existing !== undefined) {
      return existing;
    }

    const created = Semaphore.makeUnsafe(1);

    repositoryLocks.set(key, created);

    return created;
  };

  const send = (runId: RunId, update: ActionUpdate) =>
    options
      .report(runId, update)
      .pipe(Effect.catchCause((cause) => Effect.logWarning("Could not report an action", cause)));

  const finish = (runId: RunId, outcome: ActionOutcome, output: ReadonlyArray<string>) =>
    options
      .audit({ event: "ActionFinished", runId, outcome })
      .pipe(Effect.andThen(send(runId, ActionUpdate.cases.Finished.make({ outcome, output }))));

  const checkoutPlan = (
    path: string,
    network: Network,
    perform: (location: CheckoutLocation, output: ActionOutput) => Effect.Effect<ActionOutcome>,
  ): Plan => {
    const location = options.catalogue.locate(path);

    return location === undefined
      ? { _tag: "Refused", message: `This machine has no checkout at ${path}.` }
      : {
          _tag: "Ready",
          // Worktrees share one repository, and Git locks it while fetching or merging.
          lockKey: location.commonDirectory,
          network,
          perform: (output) => perform(location, output),
          afterwards: () => options.catalogue.rescanRepository(location.commonDirectory),
        };
  };

  /**
   * An action that moves a checkout in or out of the archive. Afterwards the agent forgets the old
   * path and reads the checkout at its new one.
   */
  const movePlan = (
    path: string,
    from: CheckoutLocation["placement"]["_tag"],
    move: (
      location: CheckoutLocation,
      folders: Folders,
      output: ActionOutput,
    ) => Effect.Effect<ActionOutcome>,
  ): Plan => {
    const location = options.catalogue.locate(path);

    if (location === undefined || location.placement._tag !== from) {
      return {
        _tag: "Refused",
        message: `This machine has no ${from === "Archive" ? "archived " : ""}checkout at ${path}.`,
      };
    }

    return {
      _tag: "Ready",
      lockKey: location.commonDirectory,
      network: "Local",
      perform: (output) => move(location, { ...options.folders(), home }, output),
      afterwards: (outcome) => {
        if (
          outcome._tag !== "Succeeded" ||
          (outcome.result._tag !== "Archived" && outcome.result._tag !== "Unarchived")
        ) {
          return options.catalogue.rescanRepository(location.commonDirectory);
        }

        // The main checkout goes first, so its worktrees are read once it's in its new place.
        const moves = [{ from: path, to: outcome.result.path }, ...outcome.result.worktrees];

        return Effect.forEach(moves, (moved) => options.catalogue.forget(moved.from), {
          discard: true,
        }).pipe(
          Effect.andThen(
            Effect.forEach(moves, (moved) => options.catalogue.track(moved.to), { discard: true }),
          ),
        );
      },
    };
  };

  /** An inspection fetches only when the owner allows Git actions, which cover fetching. */
  const inspectionOptions = options.loadPolicy.pipe(
    Effect.map(({ allowedTiers }): InspectionOptions => ({
      fetch: allowedTiers.includes("git") ? "Allowed" : "NotAllowed",
    })),
    Effect.orElseSucceed((): InspectionOptions => ({ fetch: "NotAllowed" })),
  );

  /**
   * An action that removes a checkout from where it is, archived or not. Afterwards the agent
   * forgets its path and reports the trash, which may have gained it.
   */
  const removalPlan = (
    path: string,
    network: Network,
    remove: (location: CheckoutLocation, output: ActionOutput) => Effect.Effect<ActionOutcome>,
  ): Plan => {
    const location = options.catalogue.locate(path);

    return location === undefined
      ? { _tag: "Refused", message: `This machine has no checkout at ${path}.` }
      : {
          _tag: "Ready",
          lockKey: location.commonDirectory,
          network,
          perform: (output) => remove(location, output),
          afterwards: (outcome) =>
            outcome._tag === "Succeeded"
              ? options.catalogue.forget(path).pipe(Effect.andThen(options.catalogue.reportTrash))
              : options.catalogue.rescanRepository(location.commonDirectory),
        };
  };

  /**
   * Removing a linked worktree of the main checkout at `path`. Afterwards the agent forgets the
   * worktree and reads the clone again, which lists its worktrees.
   */
  const worktreeRemovalPlan = (path: string, worktree: string): Plan => {
    const location = options.catalogue.locate(path);

    return location === undefined
      ? { _tag: "Refused", message: `This machine has no checkout at ${path}.` }
      : {
          _tag: "Ready",
          lockKey: location.commonDirectory,
          network: "Local",
          perform: (output) => removeWorktree(location, worktree, output),
          afterwards: (outcome) =>
            (outcome._tag === "Succeeded" ? options.catalogue.forget(worktree) : Effect.void).pipe(
              Effect.andThen(options.catalogue.rescanRepository(location.commonDirectory)),
            ),
        };
  };

  /** An action on a checkout in the trash, which reports the trash afterwards. */
  const trashItemPlan = (
    id: TrashId,
    act: (trash: string, id: TrashId, output: ActionOutput) => Effect.Effect<ActionOutcome>,
  ): Plan => ({
    _tag: "Ready",
    lockKey: `trash:${id}`,
    network: "Local",
    perform: (output) => act(options.trashDirectory, id, output),
    afterwards: (outcome) =>
      outcome._tag === "Succeeded" &&
      outcome.result._tag === "Restored" &&
      outcome.result.path !== null
        ? options.catalogue
            .track(outcome.result.path)
            .pipe(Effect.andThen(options.catalogue.reportTrash))
        : options.catalogue.reportTrash,
  });

  const plan = (request: ActionRequest): Plan =>
    ActionRequest.match(request, {
      Fetch: ({ path }) => checkoutPlan(path, "Network", fetchRepository),
      Pull: ({ path }) => checkoutPlan(path, "Network", pullCheckout),
      Switch: ({ path, branch }) =>
        checkoutPlan(path, "Local", (location, output) => switchBranch(location, branch, output)),
      Stash: ({ path }) => checkoutPlan(path, "Local", stashChanges),
      RemoveWorktree: ({ path, worktree }) => worktreeRemovalPlan(path, worktree),
      DropStashes: ({ path, stashes }) =>
        checkoutPlan(path, "Local", (location, output) => dropStashes(location, stashes, output)),
      Archive: ({ path }) => movePlan(path, "Projects", archiveCheckout),
      Unarchive: ({ path }) => movePlan(path, "Archive", unarchiveCheckout),
      DeleteBranches: ({ path, branches }) =>
        checkoutPlan(path, "Local", (location, output) =>
          deleteBranches(location, branches, output),
        ),
      Trash: ({ path, fingerprint, removeCaches }) =>
        removalPlan(path, "Local", (location, output) =>
          trashCheckout(
            location,
            { fingerprint, removeCaches, trash: options.trashDirectory },
            output,
          ),
        ),
      Delete: ({ path, fingerprint }) =>
        // Deleting inspects the checkout again, fetching first.
        removalPlan(path, "Network", (location, output) =>
          inspectionOptions.pipe(
            Effect.flatMap((inspection) =>
              deleteCheckout(location, { ...inspection, fingerprint }, output),
            ),
          ),
        ),
      Restore: ({ target }) =>
        TrashTarget.match(target, {
          Branch: ({ path, ref }) =>
            checkoutPlan(path, "Local", (location, output) => restoreBranch(location, ref, output)),
          Stash: ({ path, ref }) =>
            checkoutPlan(path, "Local", (location, output) => restoreStash(location, ref, output)),
          Checkout: ({ id }) => trashItemPlan(id, restoreCheckout),
        }),
      Purge: ({ target }) =>
        TrashTarget.match(target, {
          Branch: ({ path, ref }) =>
            checkoutPlan(path, "Local", (location, output) => purgeBranch(location, ref, output)),
          Stash: ({ path, ref }) =>
            checkoutPlan(path, "Local", (location, output) => purgeStash(location, ref, output)),
          Checkout: ({ id }) => trashItemPlan(id, purgeCheckout),
        }),
      Clone: ({ url, destination }) => {
        const folders = options.folders();
        const checked = checkCloneDestination({
          destination,
          home,
          roots: folders.roots,
          archive: folders.archiveFolder,
        });

        if (checked._tag !== "Valid") {
          return { _tag: "Refused", message: destinationProblems[checked._tag] };
        }

        return {
          _tag: "Ready",
          lockKey: `clone:${checked.path}`,
          network: "Network",
          perform: (output) =>
            cloneRepository(
              { url, destination: checked, home, archive: folders.archiveFolder },
              output,
            ),
          // Only a clone this agent made is added, so a refused one can't point it elsewhere.
          afterwards: (outcome) =>
            outcome._tag === "Succeeded" ? options.catalogue.track(checked.path) : Effect.void,
        };
      },
    });

  /** Sends Git's latest progress line whenever it changes, at most once a second. */
  const reportProgress = (runId: RunId, output: ActionOutput) => {
    let reported: string | null = null;

    return Effect.suspend(() => {
      const line = output.progress();

      if (line === null || line === reported) {
        return Effect.void;
      }

      reported = line;

      return send(runId, ActionUpdate.cases.Progress.make({ line }));
    }).pipe(Effect.andThen(Effect.sleep(progressInterval)), Effect.forever);
  };

  const notAllowed = (tier: Tier) => ({
    reason: `The ${tier} tier is not allowed`,
    outcome: ActionOutcome.cases.Skipped.make({
      reason: SkipReason.cases.NotAllowed.make({ tier }),
    }),
  });

  /**
   * Why the owner's policy refuses the tier now, or null when it allows it. An unreadable policy
   * allows nothing, and says so rather than looking like a deliberate refusal.
   */
  const policyRefusal = (tier: Tier) =>
    options.loadPolicy.pipe(
      Effect.map((policy) => (policy.allowedTiers.includes(tier) ? null : notAllowed(tier))),
      Effect.catch((error) => {
        const message = `This machine's policy can't be read, so it allows nothing: ${error.message}`;

        return Effect.succeed({
          reason: message,
          outcome: ActionOutcome.cases.Failed.make({ message }),
        });
      }),
    );

  /**
   * Inspects a checkout for the hub, if the owner allows cleanup actions. It waits for the
   * repository like an action, and for a network slot when it fetches. Every problem becomes a
   * failed result the dashboard can show.
   */
  const inspect = (path: string): Effect.Effect<InspectionResult> =>
    Effect.gen(function* () {
      if ((yield* policyRefusal("cleanup")) !== null) {
        return InspectionResult.cases.Failed.make({
          message: "Cleanup actions are turned off on this machine.",
        });
      }

      const location = options.catalogue.locate(path);

      if (location === undefined) {
        return InspectionResult.cases.Failed.make({
          message: `This machine has no checkout at ${path}.`,
        });
      }

      const inspection = yield* inspectionOptions;

      return yield* inspectCheckout(location, inspection).pipe(
        Effect.map((found) => InspectionResult.cases.Inspected.make({ inspection: found })),
        Effect.catchTag("CommandFailed", ({ message }) =>
          Effect.succeed(InspectionResult.cases.Failed.make({ message })),
        ),
        (inspecting) =>
          inspection.fetch === "Allowed" ? slots.withPermits(1)(inspecting) : inspecting,
        lockFor(location.commonDirectory).withPermits(1),
      );
    }).pipe(
      Effect.catchDefect((defect) =>
        Effect.succeed(
          InspectionResult.cases.Failed.make({
            message: `The agent hit an unexpected error: ${String(defect)}`,
          }),
        ),
      ),
    );

  /** Reports a request the agent won't run. Nothing has changed, so no outcome is logged twice. */
  const refuse = (
    runId: RunId,
    request: ActionRequest,
    refusal: { readonly reason: string; readonly outcome: ActionOutcome },
  ) =>
    options
      .audit({ event: "ActionRefused", runId, request, reason: refusal.reason })
      .pipe(
        Effect.andThen(
          send(runId, ActionUpdate.cases.Finished.make({ outcome: refusal.outcome, output: [] })),
        ),
      );

  /**
   * Checks the policy, waits for the repository and any network slot it needs, checks the policy
   * again in case the owner changed it meanwhile, then runs the action. Returns its outcome and the
   * rescan to do before reporting it, or null when the request was refused.
   */
  const perform = (runId: RunId, request: ActionRequest, output: ActionOutput) =>
    Effect.gen(function* () {
      const tier = actionTiers[request._tag];
      const refusal = yield* policyRefusal(tier);

      if (refusal !== null) {
        yield* refuse(runId, request, refusal);

        return null;
      }

      const planned = plan(request);

      if (planned._tag === "Refused") {
        yield* refuse(runId, request, {
          reason: planned.message,
          outcome: ActionOutcome.cases.Failed.make({ message: planned.message }),
        });

        return null;
      }

      return yield* Effect.gen(function* () {
        const refusedSinceArriving = yield* policyRefusal(tier);

        if (refusedSinceArriving !== null) {
          yield* refuse(runId, request, refusedSinceArriving);

          return null;
        }

        yield* send(runId, ActionUpdate.cases.Started.make({}));
        yield* options.audit({ event: "ActionStarted", runId, request });
        yield* Effect.forkScoped(reportProgress(runId, output));

        const outcome = yield* planned.perform(output);

        return { outcome, afterwards: planned.afterwards(outcome) };
      }).pipe(
        Effect.scoped,
        (performing) =>
          planned.network === "Network" ? slots.withPermits(1)(performing) : performing,
        // The repository lock is taken first, so a queued action never holds a network slot.
        lockFor(planned.lockKey).withPermits(1),
      );
    });

  const execute = (runId: RunId, request: ActionRequest) => {
    const output = makeActionOutput();

    return perform(runId, request, output).pipe(
      // A cancelled action says so. One stopped by a lost connection can't, so only the log knows.
      Effect.onInterrupt(() =>
        cancelled.delete(runId)
          ? finish(runId, ActionOutcome.cases.Cancelled.make({}), output.tail())
          : options.audit({ event: "ActionInterrupted", runId }),
      ),
      // An unexpected error still ends the run, so the hub never waits on it forever.
      Effect.catchDefect((defect) =>
        Effect.logError("An action crashed", defect).pipe(
          Effect.as({
            outcome: ActionOutcome.cases.Failed.make({
              message: `The agent hit an unexpected error: ${String(defect)}`,
            }),
            afterwards: Effect.void,
          }),
        ),
      ),
      Effect.flatMap((performed) =>
        performed === null
          ? Effect.void
          : // The rescan goes first, so the hub has the checkout's new state, or a new clone's
            // checkout, by the time it hears the outcome. The outcome is sent even when the rescan
            // fails or a cancel arrives during it.
            Effect.catchCause(performed.afterwards, (cause) =>
              Effect.logWarning("Could not rescan after an action", cause),
            ).pipe(
              Effect.ensuring(
                Effect.uninterruptible(finish(runId, performed.outcome, output.tail())),
              ),
            ),
      ),
      Effect.ensuring(Effect.sync(() => cancelled.delete(runId))),
    );
  };

  return {
    inspect,
    run: (runId: RunId, request: ActionRequest) =>
      FiberMap.run(fibers, runId, execute(runId, request), { onlyIfMissing: true }).pipe(
        Effect.asVoid,
      ),
    /** Stops a queued or running action, which then reports itself cancelled. */
    cancel: (runId: RunId) =>
      FiberMap.has(fibers, runId).pipe(
        Effect.flatMap((running) =>
          running
            ? Effect.sync(() => cancelled.add(runId)).pipe(
                Effect.andThen(FiberMap.remove(fibers, runId)),
              )
            : Effect.void,
        ),
      ),
  };
});
