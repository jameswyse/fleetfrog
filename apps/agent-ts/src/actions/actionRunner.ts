import { homedir } from "node:os";
import nodePath from "node:path";

import { Duration, Effect, FiberMap, Option, Semaphore } from "effect";

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
import { inspectWorktree } from "../inspect/inspectWorktree.ts";
// oxlint-disable-next-line wyse/no-service-constructor-imports -- Each action run collects its own output.
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

const networkConcurrency = 4;
const discoveryWait = Duration.minutes(2);

const notDiscovered =
  "This machine's agent hasn't finished finding its checkouts since it started. Try again once it has.";

const progressInterval = Duration.seconds(1);

interface CheckoutCatalogue {
  readonly discovered: Effect.Effect<void>;
  readonly locate: (path: string) => CheckoutLocation | undefined;
  readonly rescanRepository: (commonDirectory: string) => Effect.Effect<void, unknown>;
  readonly followRepository: (
    left: string | null,
    main: string | null,
  ) => Effect.Effect<void, unknown>;
  readonly reportTrash: Effect.Effect<void, unknown>;
}

type Network = "Network" | "Local";

interface Performed {
  readonly outcome: ActionOutcome;
  readonly afterwards: Effect.Effect<void, unknown>;
}

const interruption = {
  Fetch: "Cancellable",
  Pull: "Cancellable",
  Clone: "Cancellable",
  Switch: "Atomic",
  Stash: "Atomic",
  DeleteBranches: "Atomic",
  RemoveWorktree: "Atomic",
  DropStashes: "Atomic",
  Archive: "Atomic",
  Unarchive: "Atomic",
  Trash: "Atomic",
  Delete: "Atomic",
  Restore: "Atomic",
  Purge: "Atomic",
} as const satisfies Record<ActionRequest["_tag"], "Cancellable" | "Atomic">;

type Plan =
  | { readonly _tag: "Refused"; readonly message: string }
  | {
      readonly _tag: "Ready";
      readonly lockKey: string;
      readonly network: Network;
      readonly perform: (output: ActionOutput) => Effect.Effect<ActionOutcome>;
      readonly afterwards: (outcome: ActionOutcome) => Effect.Effect<void, unknown>;
    };

export const makeActionRunner = Effect.fn("makeActionRunner")(function* (options: {
  readonly catalogue: CheckoutCatalogue;
  readonly folders: () => Omit<Folders, "home">;
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
          lockKey: location.commonDirectory,
          network,
          perform: (output) => perform(location, output),
          afterwards: () => options.catalogue.rescanRepository(location.commonDirectory),
        };
  };

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
      afterwards: (outcome) =>
        outcome._tag === "Succeeded" &&
        (outcome.result._tag === "Archived" || outcome.result._tag === "Unarchived")
          ? options.catalogue.followRepository(location.commonDirectory, outcome.result.path)
          : options.catalogue.rescanRepository(location.commonDirectory),
    };
  };

  const waitForDiscovery = options.catalogue.discovered.pipe(Effect.timeoutOption(discoveryWait));

  const inspectionOptions = options.loadPolicy.pipe(
    Effect.map(({ allowedTiers }): InspectionOptions => ({
      fetch: allowedTiers.includes("git") ? "Allowed" : "NotAllowed",
    })),
    Effect.orElseSucceed((): InspectionOptions => ({ fetch: "NotAllowed" })),
  );

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
              ? options.catalogue
                  .followRepository(location.commonDirectory, null)
                  .pipe(Effect.andThen(options.catalogue.reportTrash))
              : options.catalogue.rescanRepository(location.commonDirectory),
        };
  };

  const mainLocation = (
    path: string,
    worktree: string,
  ): Pick<CheckoutLocation, "path" | "commonDirectory"> | undefined => {
    const main = options.catalogue.locate(path);

    if (main !== undefined) {
      return main;
    }

    const linked = options.catalogue.locate(worktree);

    return linked === undefined || nodePath.dirname(linked.commonDirectory) !== path
      ? undefined
      : { path, commonDirectory: linked.commonDirectory };
  };

  const worktreeRemovalPlan = (
    path: string,
    removal: { readonly worktree: string; readonly fingerprint: string },
  ): Plan => {
    const location = mainLocation(path, removal.worktree);

    return location === undefined
      ? { _tag: "Refused", message: `This machine has no checkout at ${path}.` }
      : {
          _tag: "Ready",
          lockKey: location.commonDirectory,
          network: "Local",
          perform: (output) => removeWorktree(location, removal, output),
          afterwards: (outcome) =>
            outcome._tag === "Succeeded"
              ? options.catalogue.followRepository(location.commonDirectory, location.path)
              : options.catalogue.rescanRepository(location.commonDirectory),
        };
  };

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
            .followRepository(null, outcome.result.path)
            .pipe(Effect.andThen(options.catalogue.reportTrash))
        : options.catalogue.reportTrash,
  });

  const plan = (request: ActionRequest): Plan =>
    ActionRequest.match(request, {
      Fetch: ({ path }) => checkoutPlan(path, "Network", fetchRepository),
      Pull: ({ path }) => checkoutPlan(path, "Network", pullCheckout),
      Switch: ({ path, ...target }) =>
        checkoutPlan(path, "Local", (location, output) => switchBranch(location, target, output)),
      Stash: ({ path }) => checkoutPlan(path, "Local", stashChanges),
      RemoveWorktree: ({ path, worktree, fingerprint }) =>
        worktreeRemovalPlan(path, { worktree, fingerprint }),
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
      Delete: ({ path, fingerprint, discardUniqueWork }) =>
        removalPlan(path, discardUniqueWork ? "Local" : "Network", (location, output) =>
          inspectionOptions.pipe(
            Effect.flatMap((inspection) =>
              deleteCheckout(location, { ...inspection, fingerprint, discardUniqueWork }, output),
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
          afterwards: (outcome) =>
            outcome._tag === "Succeeded"
              ? options.catalogue.followRepository(null, checked.path)
              : Effect.void,
        };
      },
    });

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

  const inspect = (request: {
    readonly path: string;
    readonly worktree: string | null;
  }): Effect.Effect<InspectionResult> =>
    Effect.gen(function* () {
      const { path, worktree } = request;

      if ((yield* policyRefusal("cleanup")) !== null) {
        return InspectionResult.cases.Failed.make({
          message: "Cleanup actions are turned off on this machine.",
        });
      }

      if (Option.isNone(yield* waitForDiscovery)) {
        return InspectionResult.cases.Failed.make({ message: notDiscovered });
      }

      const noCheckout = InspectionResult.cases.Failed.make({
        message: `This machine has no checkout at ${path}.`,
      });

      if (worktree !== null) {
        const main = mainLocation(path, worktree);

        return main === undefined
          ? noCheckout
          : yield* inspectWorktree(main, worktree).pipe(
              Effect.map((found) =>
                found === null
                  ? InspectionResult.cases.Failed.make({
                      message: `${worktree} is no longer one of this checkout's worktrees.`,
                    })
                  : InspectionResult.cases.WorktreeInspected.make({ inspection: found }),
              ),
              Effect.catchTag("CommandFailed", ({ message }) =>
                Effect.succeed(InspectionResult.cases.Failed.make({ message })),
              ),
              lockFor(main.commonDirectory).withPermits(1),
            );
      }

      const location = options.catalogue.locate(path);

      if (location === undefined) {
        return noCheckout;
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

  const perform = (
    runId: RunId,
    request: ActionRequest,
    output: ActionOutput,
    settle: (performed: Performed) => void,
  ) =>
    Effect.gen(function* () {
      const tier = actionTiers[request._tag];
      const refusal = yield* policyRefusal(tier);

      if (refusal !== null) {
        yield* refuse(runId, request, refusal);

        return null;
      }

      const found = request._tag === "Clone" ? Option.some(undefined) : yield* waitForDiscovery;

      if (Option.isNone(found)) {
        yield* refuse(runId, request, {
          reason: notDiscovered,
          outcome: ActionOutcome.cases.Failed.make({ message: notDiscovered }),
        });

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

        const running = planned.perform(output).pipe(
          Effect.map((outcome): Performed => {
            const performed = { outcome, afterwards: planned.afterwards(outcome) };

            settle(performed);

            return performed;
          }),
        );

        return yield* interruption[request._tag] === "Atomic"
          ? Effect.uninterruptible(running)
          : running;
      }).pipe(
        Effect.scoped,
        (performing) =>
          planned.network === "Network" ? slots.withPermits(1)(performing) : performing,
        lockFor(planned.lockKey).withPermits(1),
      );
    });

  const complete = (runId: RunId, performed: Performed, output: ActionOutput) =>
    Effect.catchCause(performed.afterwards, (cause) =>
      Effect.logWarning("Could not rescan after an action", cause),
    ).pipe(
      Effect.ensuring(Effect.uninterruptible(finish(runId, performed.outcome, output.tail()))),
    );

  const execute = (runId: RunId, request: ActionRequest) => {
    const output = makeActionOutput();
    let settled: Performed | null = null;
    let reporting = false;

    const report = (performed: Performed) =>
      Effect.suspend(() => {
        if (reporting) {
          return Effect.void;
        }

        reporting = true;

        return complete(runId, performed, output);
      });

    return perform(runId, request, output, (performed) => {
      settled = performed;
    }).pipe(
      Effect.catchDefect((defect) =>
        Effect.logError("An action crashed", defect).pipe(
          Effect.as<Performed>({
            outcome: ActionOutcome.cases.Failed.make({
              message: `The agent hit an unexpected error: ${String(defect)}`,
            }),
            afterwards: Effect.void,
          }),
        ),
      ),
      Effect.flatMap((performed) => (performed === null ? Effect.void : report(performed))),
      Effect.onInterrupt(() => {
        if (settled !== null) {
          return report(settled);
        }

        return cancelled.delete(runId)
          ? finish(runId, ActionOutcome.cases.Cancelled.make({}), output.tail())
          : options.audit({ event: "ActionInterrupted", runId });
      }),
      Effect.ensuring(Effect.sync(() => cancelled.delete(runId))),
    );
  };

  return {
    inspect,
    run: (runId: RunId, request: ActionRequest) =>
      FiberMap.run(fibers, runId, execute(runId, request), { onlyIfMissing: true }).pipe(
        Effect.asVoid,
      ),
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
