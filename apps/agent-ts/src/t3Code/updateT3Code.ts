import path from "node:path";

import { Duration, Effect, Option, Schema, Semaphore } from "effect";

import { T3CodeUpdateOutcome, workingT3CodeThreads } from "@fleetfrog/protocol/domain/t3CodeUpdate";

import { lastLines, runProgram } from "../process/runTool.ts";
import { readT3Code } from "./readT3Code.ts";
import { readT3CodeRuntime } from "./readT3CodeApp.ts";
import { updateT3CodeApp } from "./updateT3CodeApp.ts";

import type { AuditEntry } from "../audit/auditLog.ts";
import type { ConfigUnavailable } from "../config/agentConfig.ts";
import type { AgentPolicy } from "../config/agentPolicy.ts";
import type { ProgramResult } from "../process/runTool.ts";

const updateTimeout = Duration.minutes(10);
const serviceRestartTimeout = Duration.seconds(30);
const appRestartTimeout = Duration.minutes(2);
const restartPollInterval = Duration.seconds(1);
const maximumOutputCharacters = 1000;

class Refused extends Schema.TaggedError<Refused, { readonly brand: unique symbol }>()("Refused", {
  message: Schema.String,
}) {}

function threadsRunning(count: number): string {
  return count === 1
    ? "T3 Code is running 1 thread. Try again when it finishes."
    : `T3 Code is running ${count} threads. Try again when they finish.`;
}

function failureReason(result: ProgramResult): string {
  if (result._tag === "TimedOut") {
    return "T3 Code's updater took longer than 10 minutes and was stopped.";
  }

  return result.code === null
    ? `T3 Code's updater was stopped by ${result.signal ?? "a signal"}.`
    : `T3 Code's updater exited with code ${result.code}.`;
}

function withOutput(reason: string, output: string): string {
  const lines = lastLines(output).slice(-maximumOutputCharacters);

  return lines === "" ? reason : `${reason}\n${lines}`;
}

export interface T3CodeUpdateSession {
  readonly open: () => boolean;
  readonly report: (version: string, outcome: T3CodeUpdateOutcome) => Effect.Effect<void, unknown>;
  readonly rescan: Effect.Effect<void, unknown>;
}

export function makeT3CodeUpdater(options: {
  readonly database: () => string;
  readonly loadPolicy: Effect.Effect<AgentPolicy, ConfigUnavailable>;
  readonly audit: (entry: AuditEntry) => Effect.Effect<void>;
}) {
  const updating = Semaphore.makeUnsafe(1);

  const refuse = (message: string) => Effect.fail(new Refused({ message }));

  const runServiceUpdater = (executable: string) =>
    runProgram({ executable, args: ["update", "--yes"], timeout: updateTimeout }).pipe(
      Effect.catchTag("CommandFailed", ({ message }) =>
        refuse(`Couldn't run T3 Code's updater: ${message}`),
      ),
      Effect.flatMap((result) =>
        result._tag === "TimedOut" || result.code !== 0
          ? refuse(withOutput(failureReason(result), result.output))
          : Effect.void,
      ),
    );

  const runUpdater = Effect.fnUntraced(function* (version: string) {
    const allowed = yield* options.loadPolicy.pipe(
      Effect.map(({ allowedTiers }) => allowedTiers.includes("t3code")),
      Effect.catch((error) =>
        refuse(`This machine's policy can't be read, so it allows nothing: ${error.message}`),
      ),
    );

    if (!allowed) {
      return yield* refuse(
        "This machine's owner hasn't allowed T3 Code updates from the hub. Run fleetfrog allow t3code on it.",
      );
    }

    const database = options.database();
    const userdata = path.dirname(database);
    const runtime = yield* readT3CodeRuntime(userdata);

    if (runtime === null) {
      return yield* refuse("T3 Code's server isn't running.");
    }

    const { executable, server } = runtime;

    if (server.serviceManaged && executable === null) {
      return yield* refuse("Couldn't find T3 Code's executable.");
    }

    const checkThreads = readT3Code({ database, projectIcons: false, favicons: new Map() }).pipe(
      Effect.flatMap(({ status }) => {
        if (status.reading._tag !== "Read" || status.reading.unreadRecords > 0) {
          return refuse(
            "FleetFrog can't read all of T3 Code's database here, so it can't tell whether a thread is running. Update T3 Code on the machine itself.",
          );
        }

        const working = workingT3CodeThreads(status);

        return working > 0 ? refuse(threadsRunning(working)) : Effect.void;
      }),
    );

    yield* checkThreads;

    const installed =
      server.serviceManaged && executable !== null
        ? yield* runServiceUpdater(executable).pipe(Effect.as(version))
        : yield* updateT3CodeApp({
            home: path.dirname(userdata),
            port: server.port,
            version,
            recheck: checkThreads,
          }).pipe(Effect.catchTag("T3CodeAppUpdateFailed", ({ message }) => refuse(message)));

    return {
      userdata,
      pid: runtime.pid,
      previousVersion: server.version,
      installed,
      restartTimeout: server.serviceManaged ? serviceRestartTimeout : appRestartTimeout,
    };
  });

  const waitForRestart = (userdata: string, pid: number, restartTimeout: Duration.Duration) =>
    Effect.sleep(restartPollInterval).pipe(
      Effect.andThen(readT3CodeRuntime(userdata)),
      Effect.repeat({ until: (runtime) => runtime !== null && runtime.pid !== pid }),
      Effect.timeoutOption(restartTimeout),
    );

  const reportOutcome = (
    session: T3CodeUpdateSession,
    version: string,
    outcome: T3CodeUpdateOutcome,
  ) =>
    session
      .report(version, outcome)
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not report the T3 Code update", cause),
        ),
      );

  const fail = Effect.fnUntraced(function* (
    session: T3CodeUpdateSession,
    version: string,
    message: string,
  ) {
    yield* Effect.logWarning(`Could not update T3 Code to ${version}`, message);

    if (session.open()) {
      yield* reportOutcome(session, version, T3CodeUpdateOutcome.cases.Failed.make({ message }));
    }
  });

  const updateOnce = Effect.fnUntraced(function* (session: T3CodeUpdateSession, version: string) {
    const attempt = yield* runUpdater(version).pipe(Effect.result);

    if (attempt._tag === "Failure") {
      yield* fail(session, version, attempt.failure.message);

      return;
    }

    const { userdata, pid, previousVersion, installed, restartTimeout } = attempt.success;

    yield* Effect.logInfo(`Updated T3 Code to ${installed}`);
    yield* options.audit({ event: "T3CodeUpdated", previousVersion, version: installed });

    if (!session.open()) {
      return;
    }

    yield* reportOutcome(session, installed, T3CodeUpdateOutcome.cases.Updated.make({}));

    if (Option.isNone(yield* waitForRestart(userdata, pid, restartTimeout))) {
      yield* Effect.logWarning(
        `T3 Code's server hadn't restarted ${Duration.format(restartTimeout)} after its update`,
      );
    }

    if (session.open()) {
      yield* session.rescan.pipe(
        Effect.catchCause((cause) => Effect.logWarning("Could not rescan T3 Code", cause)),
      );
    }
  });

  const update = Effect.fn("updateT3Code")(function* (
    version: string,
    session: T3CodeUpdateSession,
  ) {
    yield* Effect.logInfo(`Updating T3 Code to ${version}`);

    const ran = yield* updateOnce(session, version).pipe(updating.withPermitsIfAvailable(1));

    if (Option.isNone(ran)) {
      yield* fail(session, version, "T3 Code is already updating.");
    }
  });

  return { update };
}
