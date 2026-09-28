import { randomUUID } from "node:crypto";

import { Context, DateTime, Effect, Layer, Stream, SubscriptionRef } from "effect";

import { HubCommand } from "@fleetfrog/protocol/agent/rpcs";
import { ActionOutcome, ActionUpdate } from "@fleetfrog/protocol/domain/action";
import { BatchId, RunId } from "@fleetfrog/protocol/domain/activity";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import { ActivityFeed } from "../activity/activityFeed.ts";
import { ActivityStore } from "../activity/activityStore.ts";
import { AgentSessions } from "../agents/agentSessions.ts";
import { FleetFeed } from "../catalogue/fleetFeed.ts";
import { planBatch } from "./planBatch.ts";

import type {
  MachineNotFound,
  NoCloneSource,
  NothingToRun,
  RepositoryNotFound,
  CancelTarget,
} from "@fleetfrog/protocol/dashboard/rpcs";
import type { Actor, BatchRequest } from "@fleetfrog/protocol/domain/activity";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";

import type { UnfinishedRun } from "../activity/activityStore.ts";

/** Starts batches, relays agents' reports on them and cancels them. */
export class ActionDispatcher extends Context.Service<
  ActionDispatcher,
  {
    readonly start: (
      request: BatchRequest,
      requestedBy: Actor,
    ) => Effect.Effect<
      BatchId,
      MachineNotFound | RepositoryNotFound | NothingToRun | NoCloneSource
    >;
    readonly cancel: (target: CancelTarget) => Effect.Effect<void>;
    /** Records an agent's report about one of its own runs. Reports about other runs are ignored. */
    readonly receive: (report: {
      readonly machineId: MachineId;
      readonly runId: RunId;
      readonly update: ActionUpdate;
    }) => Effect.Effect<void>;
  }
>()("fleetfrog/ActionDispatcher") {
  static readonly layer = Layer.effect(this)(
    Effect.gen(function* () {
      const sessions = yield* AgentSessions;
      const store = yield* ActivityStore;
      const activity = yield* ActivityFeed;
      const fleet = yield* FleetFeed;
      /** The connection each sent run went to. A run outlives its connection only as a result. */
      const dispatched = new Map<
        RunId,
        { readonly machineId: MachineId; readonly sessionId: string }
      >();

      const interrupt = (run: UnfinishedRun) =>
        DateTime.now.pipe(
          Effect.flatMap((at) =>
            store.markFinished({
              ...run,
              outcome: ActionOutcome.cases.Interrupted.make({}),
              output: [],
              at,
            }),
          ),
        );

      // Runs left unfinished by a previous hub process will never report.
      yield* store
        .unfinished({ _tag: "All" })
        .pipe(Effect.flatMap((runs) => Effect.forEach(runs, interrupt, { discard: true })));

      // An agent that disconnects or reconnects abandons its actions, so they end as interrupted.
      yield* SubscriptionRef.changes(sessions.online).pipe(
        Stream.runForEach((online) =>
          Effect.gen(function* () {
            const lost = [...dispatched].filter(
              ([, { machineId, sessionId }]) => online.get(machineId)?.sessionId !== sessionId,
            );

            if (lost.length === 0) {
              return;
            }

            for (const [runId, { machineId }] of lost) {
              dispatched.delete(runId);
              yield* interrupt({ runId, machineId });
            }

            yield* activity.invalidate;
          }),
        ),
        Effect.forkScoped,
      );

      return {
        start: Effect.fn("ActionDispatcher.start")(function* (request, requestedBy) {
          const plan = yield* planBatch(request, yield* fleet.current);
          const batchId = BatchId.make(randomUUID());
          const runs = plan.runs.map((run) => ({ ...run, id: RunId.make(randomUUID()) }));

          yield* store.createBatch({
            id: batchId,
            kind: plan.kind,
            scope: plan.scope,
            requestedAt: yield* DateTime.now,
            requestedBy,
            runs: runs.map((run) => ({
              id: run.id,
              machineId: run.machine.id,
              machineName: machineLabel(run.machine),
              repositoryKey: run.repository.key,
              repositoryName: run.repository.label,
              path: run.path,
              request: run.request,
              outcome: run.outcome,
            })),
          });

          for (const run of runs) {
            if (run.outcome !== null) {
              continue;
            }

            const sessionId = yield* sessions.send(
              run.machine.id,
              HubCommand.cases.RunAction.make({ runId: run.id, request: run.request }),
            );

            if (sessionId === null) {
              yield* store.markFinished({
                runId: run.id,
                machineId: run.machine.id,
                outcome: ActionOutcome.cases.MachineOffline.make({}),
                output: [],
                at: yield* DateTime.now,
              });
            } else {
              dispatched.set(run.id, { machineId: run.machine.id, sessionId });
            }
          }

          yield* activity.invalidate;

          return batchId;
        }),
        cancel: Effect.fn("ActionDispatcher.cancel")(function* (target) {
          const runs =
            target._tag === "Batch"
              ? yield* store.unfinished({ _tag: "Batch", batchId: target.batchId })
              : (yield* store.unfinished({ _tag: "All" })).filter(
                  ({ runId }) => runId === target.runId,
                );

          // The agent reports each cancellation as the run's outcome.
          yield* Effect.forEach(
            runs,
            ({ runId, machineId }) =>
              sessions.send(machineId, HubCommand.cases.CancelAction.make({ runId })),
            { discard: true },
          );
        }),
        receive: Effect.fn("ActionDispatcher.receive")(function* ({ machineId, runId, update }) {
          const run = { runId, machineId };
          const changed = yield* ActionUpdate.match(update, {
            Started: () =>
              DateTime.now.pipe(Effect.flatMap((at) => store.markStarted({ ...run, at }))),
            Progress: ({ line }) => store.markProgress({ ...run, line }),
            // Only the machine running it can finish a run, so a stray report changes nothing.
            Finished: ({ outcome, output }) =>
              DateTime.now.pipe(
                Effect.flatMap((at) => store.markFinished({ ...run, outcome, output, at })),
                Effect.tap((finished) =>
                  Effect.sync(() => {
                    if (finished) {
                      dispatched.delete(runId);
                    }
                  }),
                ),
              ),
          });

          if (changed) {
            yield* activity.invalidate;
          }
        }),
      };
    }),
  );
}
