import { Clock, Duration, Effect, Fiber, FiberHandle, Option, Schema, Stream } from "effect";

import { HubCommand, heartbeatSeconds } from "@fleetfrog/protocol/agent/rpcs";
import { ActionKind } from "@fleetfrog/protocol/domain/action";

import { makeActionRunner } from "../actions/actionRunner.ts";
import { writeAuditEntry } from "../audit/auditLog.ts";
import { loadAgentConfig } from "../config/agentConfig.ts";
import { loadPolicy, policyPath } from "../config/agentPolicy.ts";
import { makeHubClient } from "../connection/hubClient.ts";
import { createProjectFolder } from "../folders/createProjectFolder.ts";
import { readMachineInfo } from "../machine/machineInfo.ts";
import { readSystemUsage } from "../machine/systemInfo.ts";
import { makeScanner } from "./scanner.ts";

import type { AgentCapabilities } from "@fleetfrog/protocol/domain/action";

import type { AgentConfig } from "../config/agentConfig.ts";

export class NotPaired extends Schema.TaggedError<NotPaired>()("NotPaired", {}) {}

/** The hub no longer accepts this machine's token, usually because it was removed from the dashboard. */
export class MachineRemoved extends Schema.TaggedError<MachineRemoved>()("MachineRemoved", {}) {}

type Configuration = (typeof HubCommand.cases.Configure)["Type"];

const firstRetryDelay = Duration.seconds(1);
const maximumRetryDelay = Duration.seconds(60);
/** Disk space and load change slowly, and a minute keeps the dashboard current enough. */
const usageInterval = Duration.minutes(1);
/** A connection that lasted this long was healthy, so the next retry starts from the shortest delay. */
const healthyConnection = Duration.seconds(60);

function sameList(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/** Every action this agent knows, with the tiers its policy allows. A damaged policy allows none. */
const readCapabilities = loadPolicy.pipe(
  Effect.map(({ allowedTiers }): AgentCapabilities => ({
    actions: ActionKind.literals,
    allowedTiers,
    policyReadable: true,
    createsFolders: true,
  })),
  Effect.orElseSucceed((): AgentCapabilities => ({
    actions: ActionKind.literals,
    allowedTiers: [],
    policyReadable: false,
    createsFolders: true,
  })),
);

/** Says once, rather than every heartbeat, that the policy can't be read. */
const warnIfUnreadable = (capabilities: AgentCapabilities) =>
  capabilities.policyReadable
    ? Effect.void
    : Effect.logWarning(`The policy at ${policyPath()} can't be read, so no actions are allowed`);

/** One connection to the hub: follows its commands until the connection ends. */
const runSession = Effect.fn("runSession")(function* (config: AgentConfig) {
  const { client, disconnected } = yield* makeHubClient(config);
  const info = yield* readMachineInfo;
  const scanner = makeScanner({
    githubLogin: info.githubCli._tag === "Available" ? info.githubCli.login : null,
    report: (report) => client.Report({ report }),
  });
  const timers = yield* FiberHandle.make();
  const sessionScope = yield* Effect.scope;
  let configuration: Configuration | null = null;
  let capabilities = yield* readCapabilities;

  yield* warnIfUnreadable(capabilities);
  const actions = yield* makeActionRunner({
    catalogue: scanner,
    discoveryRoots: () => configuration?.discoveryRoots ?? [],
    loadPolicy,
    report: (runId, update) => client.ReportAction({ runId, update }),
    audit: writeAuditEntry,
  });

  /** The owner may change the policy at any time, so each heartbeat checks it. */
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
        githubMaximumAge: Duration.seconds(current.schedule.githubSeconds),
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
    scanner.status(Duration.seconds(current.schedule.githubSeconds)).pipe(
      Effect.andThen(Clock.currentTimeMillis),
      Effect.flatMap((finishedAt) =>
        Effect.sync(() => {
          lastStatusAt = finishedAt;
        }),
      ),
      Effect.catchCause((cause) => Effect.logWarning("Status scan failed", cause)),
    );

  /** Restarts both timers, keeping each on its cadence from its last completed pass. */
  const schedule = Effect.fnUntraced(function* ({
    current,
    discoverNow,
  }: {
    readonly current: Configuration;
    /** Starts a discovery walk immediately instead of waiting out its interval. */
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
    // Passes run in the session's scope, so restarting the timers never cuts a scan short.
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
    Stream.runForEach((command) =>
      HubCommand.match(command, {
        Configure: (next) => {
          const rootsChanged =
            configuration === null || !sameList(configuration.discoveryRoots, next.discoveryRoots);

          configuration = next;

          return schedule({ current: next, discoverNow: rootsChanged });
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
            home: info.homeDirectory,
            loadPolicy,
            audit: writeAuditEntry,
          }).pipe(
            Effect.tap((outcome) => client.ReportFolder({ requestId, outcome })),
            // Rediscovers so the hub sees the folder, including one that was there all along.
            Effect.flatMap((outcome) =>
              outcome._tag === "Failed" || configuration === null
                ? Effect.void
                : schedule({ current: configuration, discoverNow: true }),
            ),
            Effect.catchCause((cause) =>
              Effect.logWarning("Could not answer a folder request", cause),
            ),
          ),
      }),
    ),
    Effect.catchTag("Unauthorised", () => Effect.fail(new MachineRemoved())),
    Effect.raceFirst(disconnected),
  );
});

/** Stays connected to the hub, reconnecting with backoff, until the machine is removed. */
export const runAgent = Effect.gen(function* () {
  const config = yield* loadAgentConfig;

  if (Option.isNone(config)) {
    return yield* new NotPaired();
  }

  let delay = firstRetryDelay;

  const connectOnce = Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis;

    // Only a removed machine stops the agent. Everything else, including defects, is retried.
    yield* Effect.scoped(runSession(config.value)).pipe(
      Effect.andThen(Effect.logInfo("The hub closed the connection")),
      Effect.catchIf(
        (error) => error._tag !== "MachineRemoved",
        (error) => Effect.logWarning("Disconnected from hub", error),
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
