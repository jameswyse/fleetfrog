import { DateTime, Duration, Effect, FiberMap, PubSub, Schema, Semaphore, Stream } from "effect";
import { RpcClient } from "effect/rpc";

import { HubCommand, heartbeatSeconds, ScanReport } from "@fleetfrog/protocol/agent/rpcs";
import { ActionOutcome, ActionUpdate } from "@fleetfrog/protocol/domain/action";

import { createFolder, inspect, planAction } from "./demoActions.ts";
import {
  machineInfo,
  projectIconFiles,
  renderCheckouts,
  renderT3Code,
  renderTrash,
  sampleUsage,
} from "./demoWorld.ts";

import type { RpcGroup } from "effect/rpc";

import type { AgentRpcs, T3CodeAgentSettings } from "@fleetfrog/protocol/agent/rpcs";
import type { ActionRequest, AgentCapabilities } from "@fleetfrog/protocol/domain/action";
import type { RunId } from "@fleetfrog/protocol/domain/activity";

import type { DemoWorld, SimMachine } from "./demoWorld.ts";

type AgentClient = RpcClient.RpcClient<RpcGroup.Rpcs<typeof AgentRpcs>>;

const isHubCommand = Schema.is(HubCommand);

const capabilities: AgentCapabilities = {
  actions: [
    "Fetch",
    "Pull",
    "Clone",
    "Switch",
    "Stash",
    "Discard",
    "DeleteBranches",
    "RemoveWorktree",
    "DropStashes",
    "Archive",
    "Unarchive",
    "Trash",
    "Delete",
    "Restore",
    "Purge",
  ],
  allowedTiers: ["git", "cleanup"],
  policyReadable: true,
  createsFolders: true,
  updatesItself: false,
};

const usageInterval = Duration.minutes(1);
const inspectionTime = Duration.millis(700);
const concurrentActions = 3;

export const runSimulatedAgent = Effect.fn("runSimulatedAgent")(function* (options: {
  readonly client: AgentClient;
  readonly token: string;
  readonly world: DemoWorld;
  readonly machine: SimMachine;
  readonly agentVersion: string;
  readonly worldChanged: PubSub.PubSub<void>;
}) {
  const { client, world, machine } = options;
  const headers = { authorization: `Bearer ${options.token}` };
  const runs = yield* FiberMap.make<RunId>();
  const permits = yield* Semaphore.make(concurrentActions);
  const worldChanges = yield* PubSub.subscribe(options.worldChanged);

  let roots: ReadonlyArray<string> = [];
  let t3Code: T3CodeAgentSettings | null = null;
  let statusSeconds = 30;

  const send = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    RpcClient.withHeaders(effect, headers).pipe(
      Effect.catchCause((cause) => Effect.logWarning("A demo agent couldn't reach the hub", cause)),
    );

  const report = (scan: ScanReport) => send(client.Report({ report: scan }));

  const publish = Effect.gen(function* () {
    const now = yield* DateTime.now;
    const folders = [...roots, ...(machine.archiveFolder === null ? [] : [machine.archiveFolder])];

    yield* report(
      ScanReport.cases.Discovery.make({
        checkouts: renderCheckouts(machine, now),
        roots: folders.map((path) => ({ path, status: "Folder" as const })),
        completedAt: now,
      }),
    );
    yield* report(ScanReport.cases.Trash.make({ items: renderTrash(machine) }));

    const status = t3Code === null ? null : renderT3Code(machine, now);

    if (status !== null) {
      yield* report(ScanReport.cases.T3Code.make({ status }));
      yield* report(
        ScanReport.cases.ProjectIcons.make({
          icons: t3Code?.projectIcons === true ? projectIconFiles(machine) : [],
        }),
      );
    }
  });

  const update = (runId: RunId, change: ActionUpdate) =>
    send(client.ReportAction({ runId, update: change }));

  const runAction = Effect.fnUntraced(
    function* (runId: RunId, request: ActionRequest) {
      yield* update(runId, ActionUpdate.cases.Started.make({}));

      const preview = planAction({ world, machine, request, now: yield* DateTime.now });
      const pause = Duration.millis(preview.millis / (preview.progress.length + 1));

      for (const line of preview.progress) {
        yield* Effect.sleep(pause);
        yield* update(runId, ActionUpdate.cases.Progress.make({ line }));
      }

      yield* Effect.sleep(pause);

      const plan = planAction({ world, machine, request, now: yield* DateTime.now });

      plan.apply();
      yield* update(
        runId,
        ActionUpdate.cases.Finished.make({ outcome: plan.outcome, output: plan.output }),
      );
      yield* publish;
    },
    permits.withPermits(1),
    (effect, runId) =>
      Effect.onInterrupt(effect, () =>
        update(
          runId,
          ActionUpdate.cases.Finished.make({
            outcome: ActionOutcome.cases.Cancelled.make({}),
            output: [],
          }),
        ),
      ),
  );

  const handle = (command: HubCommand) =>
    HubCommand.match(command, {
      Configure: (next) => {
        roots = next.discoveryRoots;
        t3Code = next.t3Code;
        machine.archiveFolder = next.archiveFolder;
        statusSeconds = next.schedule.statusSeconds;

        return publish;
      },
      Refresh: () => publish,
      RunAction: ({ runId, request }) =>
        FiberMap.run(runs, runId, runAction(runId, request)).pipe(Effect.asVoid),
      CancelAction: ({ runId }) => FiberMap.remove(runs, runId),
      CreateFolder: ({ requestId, path }) =>
        send(client.ReportFolder({ requestId, outcome: createFolder(machine, path) })),
      Inspect: ({ requestId, path, worktree }) =>
        send(
          client.ReportInspection({ requestId, result: inspect(machine, { path, worktree }) }),
        ).pipe(Effect.delay(inspectionTime), Effect.forkScoped, Effect.asVoid),
      Update: ({ version }) =>
        send(
          client.ReportUpdateFailure({
            version,
            message: "Demo machines can't update their agent.",
          }),
        ),
    });

  yield* send(client.Heartbeat()).pipe(
    Effect.andThen(Effect.sleep(Duration.seconds(heartbeatSeconds))),
    Effect.forever,
    Effect.forkScoped,
  );

  yield* DateTime.now.pipe(
    Effect.flatMap((now) => send(client.ReportUsage({ usage: sampleUsage(machine.spec, now) }))),
    Effect.andThen(Effect.sleep(usageInterval)),
    Effect.forever,
    Effect.forkScoped,
  );

  yield* Effect.suspend(() => Effect.sleep(Duration.seconds(statusSeconds))).pipe(
    Effect.andThen(DateTime.now),
    Effect.flatMap((now) =>
      report(ScanReport.cases.Status.make({ changed: [], removedPaths: [], completedAt: now })),
    ),
    Effect.forever,
    Effect.forkScoped,
  );

  yield* Stream.fromSubscription(worldChanges).pipe(
    Stream.runForEach(() => publish),
    Effect.forkScoped,
  );

  const now = yield* DateTime.now;

  return yield* client
    .Connect(
      { info: machineInfo(machine.spec, now, options.agentVersion), capabilities },
      { headers },
    )
    .pipe(
      Stream.runForEach((received) => (isHubCommand(received) ? handle(received) : Effect.void)),
    );
});
