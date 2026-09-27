import { Effect, Option } from "effect";

import {
  MachineNotFound,
  NoCloneSource,
  NothingToRun,
  RepositoryNotFound,
} from "@fleetfrog/protocol/dashboard/rpcs";
import { actionBlocker } from "@fleetfrog/protocol/domain/actionAvailability";
import { ActionScope, BatchRequest } from "@fleetfrog/protocol/domain/activity";
import { clonePath } from "@fleetfrog/protocol/domain/checkout";
import { cloneSource, expandHome } from "@fleetfrog/protocol/domain/cloneDestination";
import { machineLabel } from "@fleetfrog/protocol/domain/fleet";
import { repositoryKey as keyOfRepository } from "@fleetfrog/protocol/domain/repositoryIdentity";

import type {
  ActionKind,
  ActionOutcome,
  ActionRequest,
  TargetedRequest,
} from "@fleetfrog/protocol/domain/action";
import type { BatchScope, TargetedRun } from "@fleetfrog/protocol/domain/activity";
import type { Fleet, Machine, MachineCheckout, Repository } from "@fleetfrog/protocol/domain/fleet";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";
import type { TrashedCheckout } from "@fleetfrog/protocol/domain/trash";

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

/**
 * Which checkouts each targeted action may act on. Only an archived checkout can be unarchived, and
 * an archived one can still lose its worktrees, stashes and branches or go to the trash.
 */
const targetPlacements = {
  Switch: "Active",
  Stash: "Active",
  DeleteBranches: "Either",
  RemoveWorktree: "Either",
  DropStashes: "Either",
  Archive: "Active",
  Unarchive: "Archived",
  Trash: "Either",
  Delete: "Either",
  Restore: "Either",
  Purge: "Either",
} as const satisfies Record<TargetedRequest["_tag"], "Active" | "Archived" | "Either">;

/** What a targeted request names: a checkout by its path, or a checkout in the trash. */
function targetOf(
  targeted: TargetedRequest,
):
  | { readonly _tag: "Path"; readonly path: string }
  | { readonly _tag: "Trashed"; readonly id: TrashedCheckout["id"] } {
  if (targeted._tag !== "Restore" && targeted._tag !== "Purge") {
    return { _tag: "Path", path: targeted.path };
  }

  const { target } = targeted;

  return target._tag === "Checkout"
    ? { _tag: "Trashed", id: target.id }
    : { _tag: "Path", path: target.path };
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
  const archivedTargets = fleet.archive.flatMap((repository) =>
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
              repositoryName: selected.repository.label,
              path,
            },
          } satisfies Resolved;
        }),
      Repository: ({ repositoryKey }): Effect.Effect<Resolved, PlanError> =>
        findRepository(repositoryKey).pipe(
          Effect.map((repository): Resolved => ({
            targets: repository.checkouts.map((entry) => ({ repository, entry })),
            scope: { _tag: "Repository", repositoryName: repository.label },
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

  /**
   * The checkouts a targeted request may act on. Only an archived checkout can be unarchived, and
   * removing a checkout or acting on the trash covers both kinds. Every other action works on
   * active checkouts.
   */
  const candidatesFor = (targeted: TargetedRequest): ReadonlyArray<Target> =>
    ({
      Active: allTargets,
      Archived: archivedTargets,
      Either: [...allTargets, ...archivedTargets],
    })[targetPlacements[targeted._tag]];

  /**
   * The repository a trashed checkout belongs to. One no longer anywhere else in the fleet stands
   * alone, named after its folder.
   */
  const trashedRepository = (item: TrashedCheckout): Repository => {
    const key = keyOfRepository(item.identity);

    return (
      [...fleet.repositories, ...fleet.archive].find((repository) => repository.key === key) ?? {
        key,
        identity: item.identity,
        name: item.directoryName,
        label: item.directoryName,
        icon: null,
        checkouts: [],
      }
    );
  };

  /** The repository and path a targeted request acts on, as the fleet knows them now. */
  const locate = (
    machineId: MachineId,
    targeted: TargetedRequest,
  ): Effect.Effect<Pick<PlannedRun, "repository" | "path">, PlanError> =>
    Effect.gen(function* () {
      const target = targetOf(targeted);

      if (target._tag === "Trashed") {
        const item = (yield* findMachine(machineId)).trash.find(({ id }) => id === target.id);

        if (item === undefined) {
          return yield* new NothingToRun();
        }

        return { repository: trashedRepository(item), path: item.originalPath };
      }

      // A worktree outside the project folders may be listed without its main checkout.
      const paths =
        targeted._tag === "RemoveWorktree" ? [target.path, targeted.worktree] : [target.path];
      const candidates = candidatesFor(targeted);
      const found = paths
        .map((path) =>
          candidates.find(
            ({ entry }) => entry.machineId === machineId && entry.checkout.path === path,
          ),
        )
        .find((candidate) => candidate !== undefined);

      if (found === undefined) {
        return yield* new NothingToRun();
      }

      return { repository: found.repository, path: found.entry.checkout.path };
    });

  /** One checkout's name when the batch has a single run, or the machine, or the whole fleet. */
  const targetedScope = (runs: ReadonlyArray<PlannedRun>): BatchScope => {
    const [only, ...others] = runs;

    if (only === undefined) {
      return { _tag: "All" };
    }

    if (others.length === 0) {
      return {
        _tag: "Checkout",
        machineName: machineLabel(only.machine),
        repositoryName: only.repository.label,
        path: only.path,
      };
    }

    return runs.every(({ machine }) => machine.id === only.machine.id)
      ? { _tag: "Machine", machineName: machineLabel(only.machine) }
      : { _tag: "All" };
  };

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
        const url = cloneSource(repository);

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
          scope: { _tag: "Repository", repositoryName: repository.label },
          runs,
        };
      }),
    Targeted: ({ runs }): Effect.Effect<BatchPlan, PlanError> =>
      Effect.gen(function* () {
        // The request's schema holds every run to the first one's kind.
        const kind = runs[0].request._tag;
        // A target that's gone since the dashboard showed it, such as an item already restored,
        // is left out, so the rest still run. Only a batch left with nothing fails.
        const planned = yield* Effect.forEach(
          runs,
          ({ machineId, request: targeted }: TargetedRun) =>
            Effect.gen(function* () {
              const machine = yield* findMachine(machineId);
              const target = yield* locate(machineId, targeted).pipe(Effect.option);

              return Option.map(target, (found): PlannedRun => ({
                machine,
                ...found,
                request: targeted,
                outcome: actionBlocker(machine, kind),
              }));
            }),
        ).pipe(Effect.map((found) => found.flatMap((run) => Option.toArray(run))));

        return { kind, scope: targetedScope(planned), runs: planned };
      }),
  });

  if (plan.runs.length === 0) {
    return yield* new NothingToRun();
  }

  return plan;
});
