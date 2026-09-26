import { Effect } from "effect";

import {
  MachineNotFound,
  NoCloneSource,
  NothingToRun,
  RepositoryNotFound,
} from "@fleetfrog/protocol/dashboard/rpcs";
import { actionBlocker } from "@fleetfrog/protocol/domain/actionAvailability";
import { ActionScope, BatchRequest } from "@fleetfrog/protocol/domain/activity";
import { clonePath } from "@fleetfrog/protocol/domain/checkout";
import { expandHome } from "@fleetfrog/protocol/domain/cloneDestination";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";

import type { ActionKind, ActionOutcome, ActionRequest } from "@fleetfrog/protocol/domain/action";
import type { BatchScope } from "@fleetfrog/protocol/domain/activity";
import type { Fleet, Machine, MachineCheckout, Repository } from "@fleetfrog/protocol/domain/fleet";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";

export interface PlannedRun {
  readonly machine: Machine;
  readonly repository: Repository;
  /** The checkout acted on, or the absolute clone destination. */
  readonly path: string;
  readonly request: ActionRequest;
  /** Set when the run can't be sent: the machine is offline, or its agent can't or won't run it. */
  readonly outcome: ActionOutcome | null;
}

export interface BatchPlan {
  readonly kind: ActionKind;
  readonly scope: BatchScope;
  readonly runs: ReadonlyArray<PlannedRun>;
}

type Target = { readonly repository: Repository; readonly entry: MachineCheckout };

type PlanError = MachineNotFound | RepositoryNotFound | NothingToRun | NoCloneSource;

function mostCommon(values: ReadonlyArray<string>): string | undefined {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts].toSorted(([, left], [, right]) => right - left)[0]?.[0];
}

/**
 * Expands a dashboard request into one run per target against the fleet as it is now. A fetch
 * covers each repository once per machine, a pull covers each checkout, and a clone covers each
 * chosen machine.
 */
export const planBatch = Effect.fn("planBatch")(function* (request: BatchRequest, fleet: Fleet) {
  const machines = new Map(fleet.machines.map((machine) => [machine.id, machine]));

  const findMachine = (machineId: MachineId): Effect.Effect<Machine, MachineNotFound> => {
    const machine = machines.get(machineId);

    return machine === undefined
      ? Effect.fail(new MachineNotFound({ machineId }))
      : Effect.succeed(machine);
  };

  const findRepository = (
    repositoryKey: Repository["key"],
  ): Effect.Effect<Repository, RepositoryNotFound> => {
    const repository = fleet.repositories.find(({ key }) => key === repositoryKey);

    return repository === undefined
      ? Effect.fail(new RepositoryNotFound({ repositoryKey }))
      : Effect.succeed(repository);
  };

  const allTargets = fleet.repositories.flatMap((repository) =>
    repository.checkouts.map((entry) => ({ repository, entry })),
  );

  type Resolved = { readonly targets: ReadonlyArray<Target>; readonly scope: BatchScope };

  /** The checkouts in scope, with a fetch also seeing the other worktrees it could run from. */
  const resolveScope = (
    scope: ActionScope,
    kind: "Fetch" | "Pull",
  ): Effect.Effect<Resolved, PlanError> =>
    ActionScope.match(scope, {
      Checkout: ({ machineId, path }): Effect.Effect<Resolved, PlanError> =>
        Effect.gen(function* () {
          const machine = yield* findMachine(machineId);
          const selected = allTargets.find(
            ({ entry }) => entry.machineId === machineId && entry.checkout.path === path,
          );

          if (selected === undefined) {
            return yield* new NothingToRun();
          }

          const targets =
            kind === "Pull"
              ? [selected]
              : allTargets.filter(
                  ({ entry }) =>
                    entry.machineId === machineId &&
                    clonePath(entry.checkout) === clonePath(selected.entry.checkout),
                );

          return {
            targets,
            scope: {
              _tag: "Checkout",
              machineName: machineLabel(machine),
              repositoryName: selected.repository.name,
              path,
            },
          } satisfies Resolved;
        }),
      Repository: ({ repositoryKey }): Effect.Effect<Resolved, PlanError> =>
        findRepository(repositoryKey).pipe(
          Effect.map((repository): Resolved => ({
            targets: repository.checkouts.map((entry) => ({ repository, entry })),
            scope: { _tag: "Repository", repositoryName: repository.name },
          })),
        ),
      Machine: ({ machineId }): Effect.Effect<Resolved, PlanError> =>
        findMachine(machineId).pipe(
          Effect.map((machine): Resolved => ({
            targets: allTargets.filter(({ entry }) => entry.machineId === machineId),
            scope: { _tag: "Machine", machineName: machineLabel(machine) },
          })),
        ),
      All: () => Effect.succeed<Resolved>({ targets: allTargets, scope: { _tag: "All" } }),
    });

  const runFor = (target: Target, actionRequest: ActionRequest): Effect.Effect<PlannedRun> =>
    Effect.gen(function* () {
      const machine = yield* findMachine(target.entry.machineId).pipe(Effect.orDie);

      return {
        machine,
        repository: target.repository,
        path: target.entry.checkout.path,
        request: actionRequest,
        outcome: actionBlocker(machine, actionRequest._tag),
      };
    });

  const plan = yield* BatchRequest.match(request, {
    Fetch: ({ scope }): Effect.Effect<BatchPlan, PlanError> =>
      Effect.gen(function* () {
        const resolved = yield* resolveScope(scope, "Fetch");
        const byClone = new Map<string, Array<Target>>();

        for (const target of resolved.targets) {
          const key = `${target.entry.machineId}\n${clonePath(target.entry.checkout)}`;

          byClone.set(key, [...(byClone.get(key) ?? []), target]);
        }

        // Worktrees share their clone's remote-tracking refs, so one fetch per clone covers them.
        const runs = yield* Effect.forEach([...byClone.values()], (targets) => {
          const chosen =
            targets.find(({ entry }) => entry.checkout.worktree._tag === "Main") ?? targets[0];

          return chosen === undefined
            ? Effect.succeed([])
            : runFor(chosen, { _tag: "Fetch", path: chosen.entry.checkout.path }).pipe(
                Effect.map((run) => [run]),
              );
        });

        return { kind: "Fetch", scope: resolved.scope, runs: runs.flat() };
      }),
    Pull: ({ scope }): Effect.Effect<BatchPlan, PlanError> =>
      Effect.gen(function* () {
        const resolved = yield* resolveScope(scope, "Pull");
        const runs = yield* Effect.forEach(resolved.targets, (target) =>
          runFor(target, { _tag: "Pull", path: target.entry.checkout.path }),
        );

        return { kind: "Pull", scope: resolved.scope, runs };
      }),
    Clone: ({ repositoryKey, targets }): Effect.Effect<BatchPlan, PlanError> =>
      Effect.gen(function* () {
        const repository = yield* findRepository(repositoryKey);
        const url = mostCommon(
          repository.checkouts.flatMap(({ checkout }) =>
            checkout.originUrl === null ? [] : [checkout.originUrl],
          ),
        );

        if (url === undefined) {
          return yield* new NoCloneSource();
        }

        const runs = yield* Effect.forEach(targets, ({ machineId, destination }) =>
          findMachine(machineId).pipe(
            Effect.map((machine): PlannedRun => ({
              machine,
              repository,
              path: expandHome(destination.trim(), machine.info.homeDirectory),
              request: { _tag: "Clone", url, destination: destination.trim() },
              outcome: actionBlocker(machine, "Clone"),
            })),
          ),
        );

        return {
          kind: "Clone",
          scope: { _tag: "Repository", repositoryName: repository.name },
          runs,
        };
      }),
  });

  if (plan.runs.length === 0) {
    return yield* new NothingToRun();
  }

  return plan;
});
