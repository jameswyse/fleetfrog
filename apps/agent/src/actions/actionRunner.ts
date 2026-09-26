import { homedir } from "node:os";

import { Duration, Effect, FiberMap, Semaphore } from "effect";

import {
  ActionOutcome,
  ActionRequest,
  ActionUpdate,
  SkipReason,
  actionTiers,
} from "@fleetfrog/protocol/domain/action";
import { checkCloneDestination } from "@fleetfrog/protocol/domain/cloneDestination";

import { makeActionOutput } from "./actionOutput.ts";
import {
  cloneRepository,
  destinationProblems,
  fetchRepository,
  pullCheckout,
} from "./gitActions.ts";

import type { Tier } from "@fleetfrog/protocol/domain/action";
import type { RunId } from "@fleetfrog/protocol/domain/activity";

import type { AuditEntry } from "../audit/auditLog.ts";
import type { ConfigUnavailable } from "../config/agentConfig.ts";
import type { AgentPolicy } from "../config/agentPolicy.ts";
import type { CheckoutLocation } from "../git/readCheckout.ts";
import type { ActionOutput } from "./actionOutput.ts";

/** Fetches and clones that may use the network at once. */
const networkConcurrency = 4;
const progressInterval = Duration.seconds(1);

/** What an action needs from the scanner: the checkouts it knows and a way to report changes. */
interface CheckoutCatalogue {
  readonly locate: (path: string) => CheckoutLocation | undefined;
  readonly rescanRepository: (commonDirectory: string) => Effect.Effect<void, unknown>;
  readonly track: (path: string) => Effect.Effect<void, unknown>;
}

/** An action resolved against this machine: what it locks, how it runs and what to rescan after. */
type Plan =
  /** Nothing on this machine matches the request, so it can't run at all. */
  | { readonly _tag: "Refused"; readonly message: string }
  | {
      readonly _tag: "Ready";
      readonly lockKey: string;
      readonly perform: (output: ActionOutput) => Effect.Effect<ActionOutcome>;
      readonly afterwards: (outcome: ActionOutcome) => Effect.Effect<void, unknown>;
    };

/**
 * Runs the hub's action requests on this machine. Each action is checked against the owner's
 * policy when it arrives, waits for any other action on the same repository and for a network
 * slot, then reports its progress and outcome. Every step is recorded in the audit log.
 */
export const makeActionRunner = Effect.fn("makeActionRunner")(function* (options: {
  readonly catalogue: CheckoutCatalogue;
  /** The discovery folders the hub last configured. Clones must land inside one. */
  readonly discoveryRoots: () => ReadonlyArray<string>;
  readonly loadPolicy: Effect.Effect<AgentPolicy, ConfigUnavailable>;
  readonly report: (runId: RunId, update: ActionUpdate) => Effect.Effect<void, unknown>;
  readonly audit: (entry: AuditEntry) => Effect.Effect<void>;
}) {
  const fibers = yield* FiberMap.make<RunId>();
  const network = yield* Semaphore.make(networkConcurrency);
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
    perform: (location: CheckoutLocation, output: ActionOutput) => Effect.Effect<ActionOutcome>,
  ): Plan => {
    const location = options.catalogue.locate(path);

    return location === undefined
      ? { _tag: "Refused", message: `This machine has no checkout at ${path}.` }
      : {
          _tag: "Ready",
          // Worktrees share one repository, and Git locks it while fetching or merging.
          lockKey: location.commonDirectory,
          perform: (output) => perform(location, output),
          afterwards: () => options.catalogue.rescanRepository(location.commonDirectory),
        };
  };

  const plan = (request: ActionRequest): Plan =>
    ActionRequest.match(request, {
      Fetch: ({ path }) => checkoutPlan(path, fetchRepository),
      Pull: ({ path }) => checkoutPlan(path, pullCheckout),
      Clone: ({ url, destination }) => {
        const checked = checkCloneDestination({
          destination,
          home,
          roots: options.discoveryRoots(),
        });

        if (checked._tag !== "Valid") {
          return { _tag: "Refused", message: destinationProblems[checked._tag] };
        }

        return {
          _tag: "Ready",
          lockKey: `clone:${checked.path}`,
          perform: (output) => cloneRepository({ url, destination: checked, home }, output),
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
   * Checks the policy, waits for the repository and a network slot, checks the policy again in
   * case the owner changed it meanwhile, then runs the action. Returns its outcome and the rescan
   * to follow, or null when the request was refused.
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
        network.withPermits(1),
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
          : // A cancel arriving now must not stop the outcome reaching the hub.
            Effect.uninterruptible(finish(runId, performed.outcome, output.tail())).pipe(
              Effect.andThen(performed.afterwards),
              Effect.catchCause((cause) =>
                Effect.logWarning("Could not rescan after an action", cause),
              ),
            ),
      ),
      Effect.ensuring(Effect.sync(() => cancelled.delete(runId))),
    );
  };

  return {
    /** Starts an action in the background. */
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
