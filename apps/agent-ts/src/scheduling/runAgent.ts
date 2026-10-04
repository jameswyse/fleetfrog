import { Clock, Duration, Effect, Fiber, FiberHandle, Option, Schema, Stream } from "effect";

import { HubCommand, heartbeatSeconds } from "@fleetfrog/protocol/agent/rpcs";
import { ActionKind, ActionOutcome, ActionUpdate } from "@fleetfrog/protocol/domain/action";

// oxlint-disable-next-line wyse/no-service-constructor-imports -- runAgent is the agent's composition root.
import { makeActionRunner } from "../actions/actionRunner.ts";
import { writeAuditEntry } from "../audit/auditLog.ts";
import { loadAgentConfig } from "../config/agentConfig.ts";
import { loadPolicy, policyPath, recordPolicyDefaults } from "../config/agentPolicy.ts";
// oxlint-disable-next-line wyse/no-service-constructor-imports -- runAgent is the agent's composition root.
import { makeHubClient } from "../connection/hubClient.ts";
import { createProjectFolder } from "../folders/createProjectFolder.ts";
import { readMachineInfo, runsFromSource } from "../machine/machineInfo.ts";
import { readSystemUsage } from "../machine/systemInfo.ts";
import { defaultTrashDirectory } from "../trash/trashFolder.ts";
// oxlint-disable-next-line wyse/no-service-constructor-imports -- runAgent is the agent's composition root.
import { makeScanner } from "./scanner.ts";

import type { AgentCapabilities } from "@fleetfrog/protocol/domain/action";

import type { AgentConfig } from "../config/agentConfig.ts";

export class NotPaired extends Schema.TaggedError<NotPaired>()("NotPaired", {}) {}

export class MachineRemoved extends Schema.TaggedError<MachineRemoved>()("MachineRemoved", {}) {}

type Configuration = (typeof HubCommand.cases.Configure)["Type"];

const sameT3CodeSettings = Schema.toEquivalence(HubCommand.cases.Configure.fields.t3Code);

const isHubCommand = Schema.is(HubCommand);

const firstRetryDelay = Duration.seconds(1);
const maximumRetryDelay = Duration.seconds(60);
const usageInterval = Duration.minutes(1);
const healthyConnection = Duration.seconds(60);

function sameList(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

const readCapabilities = loadPolicy.pipe(
  Effect.map(({ allowedTiers }): AgentCapabilities => ({
    actions: ActionKind.literals,
    allowedTiers,
    policyReadable: true,
    createsFolders: true,
    updatesItself: false,
  })),
  Effect.orElseSucceed((): AgentCapabilities => ({
    actions: ActionKind.literals,
    allowedTiers: [],
    policyReadable: false,
    createsFolders: true,
    updatesItself: false,
  })),
);

const warnIfUnreadable = (capabilities: AgentCapabilities) =>
  capabilities.policyReadable
    ? Effect.void
    : Effect.logWarning(`The policy at ${policyPath()} can't be read, so no actions are allowed`);

const runSession = Effect.fn("runSession")(function* (config: AgentConfig) {
  const { client, disconnected } = yield* makeHubClient(config);
  const info = yield* readMachineInfo;
  const trashDirectory = defaultTrashDirectory();
  let configuration: Configuration | null = null;

  const folders = () => ({
    roots: configuration?.discoveryRoots ?? [],
    archiveFolder: configuration?.archiveFolder ?? null,
  });

  const scanner = makeScanner({
    githubLogin: info.githubCli._tag === "Available" ? info.githubCli.login : null,
    trashDirectory,
    folders,
    report: (report) => client.Report({ report }),
  });

  const timers = yield* FiberHandle.make();
  const sessionScope = yield* Effect.scope;
  let capabilities = yield* readCapabilities;

  yield* warnIfUnreadable(capabilities);

  const actions = yield* makeActionRunner({
    catalogue: scanner,
    folders,
    trashDirectory,
    loadPolicy,
    report: (runId, update) => client.ReportAction({ runId, update }),
    audit: writeAuditEntry,
  });

  const readvertise = readCapabilities.pipe(
    Effect.flatMap((current) => {
      if (
        current.policyReadable === capabilities.policyReadable &&
        sameList(current.allowedTiers, capabilities.allowedTiers)
      ) {
        return Effect.void;
      }

      capabilities = current;

      return warnIfUnreadable(current).pipe(
        Effect.andThen(client.Advertise({ capabilities: current })),
      );
    }),
  );

  let lastDiscoveryAt: number | null = null;
  let lastStatusAt: number | null = null;

  const discover = (current: Configuration) =>
    scanner
      .discover({
        roots: current.discoveryRoots,
        archiveFolder: current.archiveFolder,
        githubMaximumAge: Duration.seconds(current.schedule.githubSeconds),
        t3Code: current.t3Code,
      })
      .pipe(
        Effect.andThen(Clock.currentTimeMillis),
        Effect.flatMap((finishedAt) =>
          Effect.sync(() => {
            lastDiscoveryAt = finishedAt;
            lastStatusAt = finishedAt;
          }),
        ),
        Effect.catchCause((cause) => Effect.logWarning("Discovery failed", cause)),
      );

  const status = (current: Configuration) =>
    scanner
      .status({
        githubMaximumAge: Duration.seconds(current.schedule.githubSeconds),
        t3Code: current.t3Code,
      })
      .pipe(
        Effect.andThen(Clock.currentTimeMillis),
        Effect.flatMap((finishedAt) =>
          Effect.sync(() => {
            lastStatusAt = finishedAt;
          }),
        ),
        Effect.catchCause((cause) => Effect.logWarning("Status scan failed", cause)),
      );

  const schedule = Effect.fnUntraced(function* ({
    current,
    discoverNow,
  }: {
    readonly current: Configuration;
    readonly discoverNow: boolean;
  }) {
    const now = yield* Clock.currentTimeMillis;

    const remaining = (seconds: number, since: number | null) =>
      since === null ? Duration.zero : Duration.millis(Math.max(0, seconds * 1000 - (now - since)));

    const untilDiscovery = discoverNow
      ? Duration.zero
      : remaining(current.schedule.discoverySeconds, lastDiscoveryAt);

    const untilStatus =
      lastStatusAt === null
        ? Duration.seconds(current.schedule.statusSeconds)
        : remaining(current.schedule.statusSeconds, lastStatusAt);

    const every = (seconds: number, pass: Effect.Effect<void>) =>
      Effect.forkIn(pass, sessionScope).pipe(
        Effect.flatMap(Fiber.join),
        Effect.andThen(Effect.sleep(Duration.seconds(seconds))),
        Effect.forever,
      );

    return yield* FiberHandle.run(
      timers,
      Effect.all(
        [
          Effect.sleep(untilDiscovery).pipe(
            Effect.andThen(every(current.schedule.discoverySeconds, discover(current))),
          ),
          Effect.sleep(untilStatus).pipe(
            Effect.andThen(every(current.schedule.statusSeconds, status(current))),
          ),
        ],
        { concurrency: 2, discard: true },
      ),
    );
  });

  yield* readSystemUsage(info.platform).pipe(
    Effect.flatMap((usage) => client.ReportUsage({ usage })),
    Effect.catchCause((cause) => Effect.logWarning("Could not report system usage", cause)),
    Effect.andThen(Effect.sleep(usageInterval)),
    Effect.forever,
    Effect.forkScoped,
  );
  yield* client
    .Heartbeat()
    .pipe(
      Effect.andThen(readvertise),
      Effect.andThen(Effect.sleep(Duration.seconds(heartbeatSeconds))),
      Effect.forever,
      Effect.forkScoped,
    );
  yield* client.Connect({ info, capabilities }).pipe(
    Stream.runForEach((received) => {
      if (!isHubCommand(received)) {
        const skipping = Effect.logWarning(
          `Skipped a command this agent can't read: ${received._tag}`,
        );

        return received.runId === undefined
          ? skipping
          : skipping.pipe(
              Effect.andThen(
                client.ReportAction({
                  runId: received.runId,
                  update: ActionUpdate.cases.Finished.make({
                    outcome: ActionOutcome.cases.Failed.make({
                      message: "This machine's agent can't read the request. Update the agent.",
                    }),
                    output: [],
                  }),
                }),
              ),
              Effect.catchCause((cause) =>
                Effect.logWarning("Could not report a skipped run", cause),
              ),
            );
      }

      return HubCommand.match(received, {
        Configure: (next) => {
          const discoveryChanged =
            configuration === null ||
            !sameList(configuration.discoveryRoots, next.discoveryRoots) ||
            configuration.archiveFolder !== next.archiveFolder ||
            !sameT3CodeSettings(configuration.t3Code, next.t3Code);

          configuration = next;

          return schedule({ current: next, discoverNow: discoveryChanged });
        },
        Refresh: () =>
          configuration === null
            ? Effect.void
            : schedule({ current: configuration, discoverNow: true }),
        RunAction: ({ runId, request }) => actions.run(runId, request),
        CancelAction: ({ runId }) => actions.cancel(runId),
        CreateFolder: ({ requestId, path }) =>
          createProjectFolder({
            path,
            roots: configuration?.discoveryRoots ?? [],
            archiveFolder: configuration?.archiveFolder ?? null,
            home: info.homeDirectory,
            loadPolicy,
            audit: writeAuditEntry,
          }).pipe(
            Effect.tap((outcome) => client.ReportFolder({ requestId, outcome })),
            Effect.flatMap((outcome) =>
              outcome._tag === "Failed" || configuration === null
                ? Effect.void
                : schedule({ current: configuration, discoverNow: true }),
            ),
            Effect.catchCause((cause) =>
              Effect.logWarning("Could not answer a folder request", cause),
            ),
          ),
        Inspect: ({ requestId, path, worktree }) =>
          actions.inspect({ path, worktree }).pipe(
            Effect.flatMap((result) => client.ReportInspection({ requestId, result })),
            Effect.catchCause((cause) =>
              Effect.logWarning("Could not answer an inspection", cause),
            ),
            Effect.forkIn(sessionScope),
            Effect.asVoid,
          ),
        Update: ({ version }) =>
          client
            .ReportUpdateFailure({ version, message: runsFromSource })
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Could not answer an update request", cause),
              ),
            ),
      });
    }),
    Effect.catchTag("Unauthorised", () => Effect.fail(new MachineRemoved())),
    Effect.raceFirst(disconnected),
  );
});

export const runAgent = Effect.gen(function* () {
  const config = yield* loadAgentConfig;

  if (Option.isNone(config)) {
    return yield* new NotPaired();
  }

  yield* recordPolicyDefaults.pipe(
    Effect.flatMap((defaulted) =>
      defaulted.length === 0
        ? Effect.void
        : Effect.logInfo(`Recorded the default for ${defaulted.join(", ")} in ${policyPath()}`),
    ),
    Effect.catchTag("ConfigUnavailable", (error) =>
      Effect.logWarning("Could not record the policy's defaults", error.message),
    ),
  );

  let delay = firstRetryDelay;

  const connectOnce = Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis;

    yield* Effect.scoped(runSession(config.value)).pipe(
      Effect.andThen(Effect.logInfo("The hub closed the connection")),
      Effect.catchTag("MachineRemoved", Effect.fail, (error) =>
        Effect.logWarning("Disconnected from hub", error),
      ),
      Effect.catchDefect((defect) => Effect.logError("Agent session crashed", defect)),
    );

    const lasted = Duration.millis((yield* Clock.currentTimeMillis) - startedAt);

    if (Duration.isGreaterThan(lasted, healthyConnection)) {
      delay = firstRetryDelay;
    }

    yield* Effect.sleep(delay);
    delay = Duration.min(Duration.times(delay, 2), maximumRetryDelay);
  });

  return yield* Effect.forever(connectOnce);
});
