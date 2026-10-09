import { randomUUID } from "node:crypto";

import { DateTime, Effect } from "effect";

import { ActionOutcome, ActionResult, SkipReason } from "@fleetfrog/protocol/domain/action";
import { BatchId, RunId } from "@fleetfrog/protocol/domain/activity";

import { ActivityStore } from "../activity/activityStore.ts";
import { shortSha } from "./demoWorld.ts";

import type { ActionKind, ActionRequest } from "@fleetfrog/protocol/domain/action";
import type { BatchScope } from "@fleetfrog/protocol/domain/activity";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";

import type { NewRun } from "../activity/activityStore.ts";
import type { DemoMachineKey } from "./demoFleetData.ts";
import type { DemoWorld, SimMachine, SimRepository } from "./demoWorld.ts";

interface PastRun {
  readonly machine: SimMachine;
  readonly repository: SimRepository;
  readonly request: ActionRequest;
  readonly outcome: ActionOutcome;
  readonly output: ReadonlyArray<string>;
  readonly seconds: number;
}

function machineName(machine: SimMachine): string {
  return machine.spec.prettyName ?? machine.spec.hostname;
}

function repositoryName(repository: SimRepository): string {
  const { spec, identity } = repository.remote;

  return (
    spec.project?.title ??
    (identity._tag === "Remote" ? (identity.path.split("/").at(-1) ?? spec.folder) : spec.folder)
  );
}

function pathOf(repository: SimRepository): string {
  return repository.main.path;
}

function fetched(repository: SimRepository): ReadonlyArray<string> {
  return [`From ${repository.remote.originUrl ?? "origin"}`];
}

export const seedHistory = Effect.fn("seedHistory")(function* (options: {
  readonly world: DemoWorld;
  readonly machineIds: ReadonlyMap<DemoMachineKey, MachineId>;
}) {
  const store = yield* ActivityStore;
  const now = yield* DateTime.now;
  const { world, machineIds } = options;

  const find = (machine: DemoMachineKey, repository: string) => {
    const simMachine = world.machines.find(({ spec }) => spec.key === machine);

    const simRepository = simMachine?.repositories.find(
      ({ remote }) => remote.spec.key === repository,
    );

    return simMachine === undefined || simRepository === undefined
      ? []
      : [{ machine: simMachine, repository: simRepository }];
  };

  const record = Effect.fnUntraced(function* (batch: {
    readonly hoursAgo: number;
    readonly kind: ActionKind;
    readonly scope: BatchScope;
    readonly runs: ReadonlyArray<PastRun>;
  }) {
    const requestedAt = DateTime.subtract(now, { minutes: Math.round(batch.hoursAgo * 60) });

    const runs = batch.runs.flatMap((run) => {
      const machineId = machineIds.get(run.machine.spec.key);

      return machineId === undefined ? [] : [{ run, machineId, id: RunId.make(randomUUID()) }];
    });

    yield* store.createBatch({
      id: BatchId.make(randomUUID()),
      kind: batch.kind,
      scope: batch.scope,
      requestedAt,
      requestedBy: null,
      runs: runs.map(({ run, machineId, id }): NewRun => ({
        id,
        machineId,
        machineName: machineName(run.machine),
        repositoryKey: run.repository.remote.key,
        repositoryName: repositoryName(run.repository),
        path: pathOf(run.repository),
        request: run.request,
        outcome: null,
      })),
    });

    yield* Effect.forEach(
      runs,
      ({ run, machineId, id }, index) => {
        const startedAt = DateTime.add(requestedAt, { milliseconds: 400 + index * 150 });

        return store.markStarted({ runId: id, machineId, at: startedAt }).pipe(
          Effect.andThen(
            store.markFinished({
              runId: id,
              machineId,
              outcome: run.outcome,
              output: run.output,
              at: DateTime.add(startedAt, { milliseconds: run.seconds * 1000 }),
            }),
          ),
        );
      },
      { discard: true },
    );
  });

  const fetchAll = world.machines.flatMap((machine) =>
    machine.repositories
      .filter(
        (repository) =>
          repository.remote.originUrl !== null && repository.placement._tag === "Projects",
      )
      .map((repository): PastRun => ({
        machine,
        repository,
        request: { _tag: "Fetch", path: pathOf(repository) },
        outcome: ActionOutcome.cases.Succeeded.make({
          result: ActionResult.cases.Fetched.make({}),
        }),
        output: fetched(repository),
        seconds: 1.4,
      })),
  );

  yield* record({ hoursAgo: 26, kind: "Fetch", scope: { _tag: "All" }, runs: fetchAll });

  for (const { machine, repository } of find("studio", "excalidraw")) {
    const destination = pathOf(repository);

    yield* record({
      hoursAgo: 49,
      kind: "Clone",
      scope: { _tag: "Repository", repositoryName: repositoryName(repository) },
      runs: [
        {
          machine,
          repository,
          request: {
            _tag: "Clone",
            url: repository.remote.originUrl ?? "",
            destination,
          },
          outcome: ActionOutcome.cases.Succeeded.make({
            result: ActionResult.cases.Cloned.make({}),
          }),
          output: [
            `Cloning into '${destination}'...`,
            "remote: Enumerating objects: 48211, done.",
            "Receiving objects: 100% (48211/48211), 71.08 MiB | 24.10 MiB/s, done.",
          ],
          seconds: 9,
        },
      ],
    });
  }

  for (const { machine, repository } of find("homelab", "home-assistant")) {
    const before = repository.remote.history.at(-20);
    const after = repository.remote.history.at(-4);

    yield* record({
      hoursAgo: 7,
      kind: "Pull",
      scope: { _tag: "Repository", repositoryName: repositoryName(repository) },
      runs: [
        {
          machine,
          repository,
          request: { _tag: "Pull", path: pathOf(repository) },
          outcome: ActionOutcome.cases.Succeeded.make({
            result: ActionResult.cases.FastForwarded.make({ commits: 16 }),
          }),
          output: [
            ...fetched(repository),
            ...(before === undefined || after === undefined
              ? []
              : [`Updating ${shortSha(before.sha)}..${shortSha(after.sha)}`, "Fast-forward"]),
            " 41 files changed, 1288 insertions(+), 402 deletions(-)",
          ],
          seconds: 3,
        },
      ],
    });
  }

  for (const { machine, repository } of find("macbook", "lilypad-api")) {
    yield* record({
      hoursAgo: 0.6,
      kind: "Pull",
      scope: {
        _tag: "Checkout",
        machineName: machineName(machine),
        repositoryName: repositoryName(repository),
        path: pathOf(repository),
      },
      runs: [
        {
          machine,
          repository,
          request: { _tag: "Pull", path: pathOf(repository) },
          outcome: ActionOutcome.cases.Skipped.make({
            reason: SkipReason.cases.UncommittedChanges.make({ files: 2 }),
          }),
          output: [],
          seconds: 0.2,
        },
      ],
    });
  }

  const pulls = (["macbook", "studio", "workstation", "homelab", "devbox"] as const).flatMap(
    (machine) => find(machine, "fleetfrog"),
  );

  yield* record({
    hoursAgo: 3,
    kind: "Pull",
    scope: { _tag: "Repository", repositoryName: "FleetFrog" },
    runs: pulls.map(({ machine, repository }) => {
      const onBranch = repository.main.head !== repository.remote.spec.defaultBranch;

      return {
        machine,
        repository,
        request: { _tag: "Pull", path: pathOf(repository) },
        outcome: onBranch
          ? ActionOutcome.cases.Skipped.make({
              reason: SkipReason.cases.UncommittedChanges.make({ files: 3 }),
            })
          : ActionOutcome.cases.Succeeded.make({
              result: ActionResult.cases.FastForwarded.make({ commits: 2 }),
            }),
        output: onBranch ? [] : [...fetched(repository), "Fast-forward"],
        seconds: 2,
      };
    }),
  });
});
