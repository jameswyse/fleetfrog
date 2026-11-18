import { Array as Arr, Effect, Option } from "effect";

import {
  MachineNotFound,
  NoCloneSource,
  NothingToRun,
  RepositoryNotFound,
} from "@fleetfrog/protocol/dashboard/rpcs";
import { requestTier } from "@fleetfrog/protocol/domain/action";
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
import type { BatchScope, RepositoryClone, TargetedRun } from "@fleetfrog/protocol/domain/activity";
import type { Fleet, Machine, MachineCheckout, Repository } from "@fleetfrog/protocol/domain/fleet";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";
import type { TrashedCheckout } from "@fleetfrog/protocol/domain/trash";

export interface PlannedRun {
  readonly machine: Machine;
  readonly repository: Repository;
  readonly path: string;
  readonly request: ActionRequest;
  readonly outcome: ActionOutcome | null;
}

export interface BatchPlan {
  readonly kind: ActionKind;
  readonly scope: BatchScope;
  readonly runs: ReadonlyArray<PlannedRun>;
}

type Target = { readonly repository: Repository; readonly entry: MachineCheckout };

const targetPlacements = {
  Switch: "Active",
  Stash: "Active",
  Discard: "Active",
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

type RequestTarget =
  | { readonly _tag: "Path"; readonly path: string }
  | { readonly _tag: "Trashed"; readonly id: TrashedCheckout["id"] };

function targetOf(targeted: TargetedRequest) {
  if (targeted._tag !== "Restore" && targeted._tag !== "Purge") {
    return { _tag: "Path", path: targeted.path } satisfies RequestTarget;
  }

  const { target } = targeted;

  return (
    target._tag === "Checkout"
      ? { _tag: "Trashed", id: target.id }
      : { _tag: "Path", path: target.path }
  ) satisfies RequestTarget;
}

export const planBatch = Effect.fn("planBatch")(function* (request: BatchRequest, fleet: Fleet) {
  const machines = new Map(fleet.machines.map((machine) => [machine.id, machine]));

  const findMachine = Effect.fnUntraced(function* (machineId: MachineId) {
    const machine = machines.get(machineId);

    if (machine === undefined) {
      return yield* new MachineNotFound({ machineId });
    }

    return machine;
  });

  const findRepository = Effect.fnUntraced(function* (repositoryKey: Repository["key"]) {
    const repository = fleet.repositories.find(({ key }) => key === repositoryKey);

    if (repository === undefined) {
      return yield* new RepositoryNotFound({ repositoryKey });
    }

    return repository;
  });

  const allTargets = fleet.repositories.flatMap((repository) =>
    repository.checkouts.map((entry) => ({ repository, entry })),
  );

  const archivedTargets = fleet.archive.flatMap((repository) =>
    repository.checkouts.map((entry) => ({ repository, entry })),
  );

  type Resolved = { readonly targets: ReadonlyArray<Target>; readonly scope: BatchScope };

  const resolveScope = (scope: ActionScope, kind: "Fetch" | "Pull") =>
    ActionScope.match(scope, {
      Checkout: ({ machineId, path }) =>
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
      Repository: ({ repositoryKey }) =>
        findRepository(repositoryKey).pipe(
          Effect.map(
            (repository) =>
              ({
                targets: repository.checkouts.map((entry) => ({ repository, entry })),
                scope: { _tag: "Repository", repositoryName: repository.label },
              }) satisfies Resolved,
          ),
        ),
      Repositories: ({ groupName, repositoryKeys }) => {
        const keys = new Set(repositoryKeys);
        const repositories = fleet.repositories.filter(({ key }) => keys.has(key));

        return Effect.succeed<Resolved>({
          targets: allTargets.filter(({ repository }) => keys.has(repository.key)),
          scope: { _tag: "Group", groupName, repositories: repositories.length },
        });
      },
      Machine: ({ machineId }) =>
        findMachine(machineId).pipe(
          Effect.map(
            (machine) =>
              ({
                targets: allTargets.filter(({ entry }) => entry.machineId === machineId),
                scope: { _tag: "Machine", machineName: machineLabel(machine) },
              }) satisfies Resolved,
          ),
        ),
      All: () => Effect.succeed<Resolved>({ targets: allTargets, scope: { _tag: "All" } }),
    });

  const runFor = Effect.fnUntraced(function* (target: Target, actionRequest: ActionRequest) {
    const machine = yield* findMachine(target.entry.machineId).pipe(Effect.orDie);

    return {
      machine,
      repository: target.repository,
      path: target.entry.checkout.path,
      request: actionRequest,
      outcome: actionBlocker(machine, actionRequest._tag),
    };
  });

  const cloneRun = Effect.fnUntraced(function* ({
    repositoryKey,
    machineId,
    destination,
  }: RepositoryClone) {
    const repository = yield* findRepository(repositoryKey);
    const machine = yield* findMachine(machineId);
    const url = cloneSource(repository);

    if (url === undefined) {
      return yield* new NoCloneSource();
    }

    return {
      machine,
      repository,
      path: expandHome(destination.trim(), machine.info.homeDirectory),
      request: { _tag: "Clone", url, destination: destination.trim() },
      outcome: actionBlocker(machine, "Clone"),
    } satisfies PlannedRun;
  });

  const candidatesFor = (targeted: TargetedRequest) =>
    ({
      Active: allTargets,
      Archived: archivedTargets,
      Either: [...allTargets, ...archivedTargets],
    })[targetPlacements[targeted._tag]];

  const trashedRepository = (item: TrashedCheckout) => {
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

  const locate = Effect.fnUntraced(function* (machineId: MachineId, targeted: TargetedRequest) {
    const target = targetOf(targeted);

    if (target._tag === "Trashed") {
      const item = (yield* findMachine(machineId)).trash.find(({ id }) => id === target.id);

      if (item === undefined) {
        return yield* new NothingToRun();
      }

      return { repository: trashedRepository(item), path: item.originalPath };
    }

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

  const targetedScope = (runs: ReadonlyArray<PlannedRun>) => {
    const [only, ...others] = runs;

    if (only === undefined) {
      return { _tag: "All" } satisfies BatchScope;
    }

    if (others.length === 0) {
      return {
        _tag: "Checkout",
        machineName: machineLabel(only.machine),
        repositoryName: only.repository.label,
        path: only.path,
      } satisfies BatchScope;
    }

    return (
      runs.every(({ machine }) => machine.id === only.machine.id)
        ? { _tag: "Machine", machineName: machineLabel(only.machine) }
        : { _tag: "All" }
    ) satisfies BatchScope;
  };

  const plan = yield* BatchRequest.match(request, {
    Fetch: ({ scope }) =>
      Effect.gen(function* () {
        const resolved = yield* resolveScope(scope, "Fetch");
        const byClone = new Map<string, Array<Target>>();

        for (const target of resolved.targets) {
          const key = `${target.entry.machineId}\n${clonePath(target.entry.checkout)}`;

          byClone.set(key, [...(byClone.get(key) ?? []), target]);
        }

        const runs = yield* Effect.forEach([...byClone.values()], (targets) => {
          const chosen =
            targets.find(({ entry }) => entry.checkout.worktree._tag === "Main") ?? targets[0];

          return chosen === undefined
            ? Effect.succeed([])
            : runFor(chosen, { _tag: "Fetch", path: chosen.entry.checkout.path }).pipe(
                Effect.map((run) => [run]),
              );
        });

        return { kind: "Fetch", scope: resolved.scope, runs: runs.flat() } satisfies BatchPlan;
      }),
    Pull: ({ scope }) =>
      Effect.gen(function* () {
        const resolved = yield* resolveScope(scope, "Pull");

        const runs = yield* Effect.forEach(resolved.targets, (target) =>
          runFor(target, { _tag: "Pull", path: target.entry.checkout.path }),
        );

        return { kind: "Pull", scope: resolved.scope, runs } satisfies BatchPlan;
      }),
    Clone: ({ repositoryKey, targets }) =>
      Effect.gen(function* () {
        const repository = yield* findRepository(repositoryKey);

        const runs = yield* Effect.forEach(targets, ({ machineId, destination }) =>
          cloneRun({ repositoryKey, machineId, destination }),
        );

        return {
          kind: "Clone",
          scope: { _tag: "Repository", repositoryName: repository.label },
          runs,
        } satisfies BatchPlan;
      }),
    CloneRepositories: ({ groupName, clones }) =>
      Effect.gen(function* () {
        const runs = yield* Effect.forEach(clones, cloneRun);

        return {
          kind: "Clone",
          scope: {
            _tag: "Group",
            groupName,
            repositories: new Set(runs.map(({ repository }) => repository.key)).size,
          },
          runs,
        } satisfies BatchPlan;
      }),
    Targeted: ({ runs }) =>
      Effect.gen(function* () {
        const kind = runs[0].request._tag;

        const planned = yield* Effect.forEach(
          runs,
          ({ machineId, request: targeted }: TargetedRun) =>
            Effect.gen(function* () {
              const machine = yield* findMachine(machineId);
              const target = yield* locate(machineId, targeted).pipe(Effect.option);

              return Option.map(target, (found) => ({
                machine,
                ...found,
                request: targeted,
                outcome: actionBlocker(machine, kind, requestTier(targeted)),
              }));
            }),
        ).pipe(Effect.map((found) => found.flatMap((run) => Option.toArray(run))));

        return { kind, scope: targetedScope(planned), runs: planned };
      }),
  });

  const { runs } = plan;

  if (!Arr.isReadonlyArrayNonEmpty(runs)) {
    return yield* new NothingToRun();
  }

  return { ...plan, runs };
});
