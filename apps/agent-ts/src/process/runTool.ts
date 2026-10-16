import { execFile, spawn } from "node:child_process";
import { homedir } from "node:os";

import { Deferred, Duration, Effect, Fiber, Option, Predicate, Schema } from "effect";

import { inheritedEnvironment } from "../config/environment.ts";
import { redactCredentials } from "./redactCredentials.ts";

export class CommandFailed extends Schema.TaggedError<
  CommandFailed,
  { readonly brand: unique symbol }
>()("CommandFailed", {
  args: Schema.Array(Schema.String),
  cwd: Schema.String,
  message: Schema.String,
}) {}

const gitConfigArgs = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"];

const toolEnvironment = {
  ...inheritedEnvironment(),
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  GIT_ALLOW_PROTOCOL: "file:git:http:https:ssh",
  LC_ALL: "C",
};

const promptPrograms = new Set(["GIT_ASKPASS", "SSH_ASKPASS"]);

const actionEnvironment = {
  ...Object.fromEntries(
    Object.entries(toolEnvironment).filter(([name]) => !promptPrograms.has(name)),
  ),
  SSH_ASKPASS_REQUIRE: "never",
  GCM_INTERACTIVE: "never",
};

function execute(
  file: string,
  cwd: string,
  args: ReadonlyArray<string>,
  passed: ReadonlyArray<string>,
) {
  return Effect.callback<string, CommandFailed>((resume, signal) => {
    execFile(
      file,
      passed,
      {
        cwd,
        env: toolEnvironment,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        signal,
        timeout: 60_000,
      },
      (error, stdout, stderr) => {
        resume(
          error === null
            ? Effect.succeed(stdout)
            : Effect.fail(
                new CommandFailed({
                  args,
                  cwd,
                  message: redactCredentials(stderr.trim()) || error.message,
                }),
              ),
        );
      },
    );
  });
}

export function runTool(
  tool:
    | "git"
    | "gh"
    | "ioreg"
    | "launchctl"
    | "osascript"
    | "ps"
    | "scutil"
    | "sw_vers"
    | "sysctl"
    | "systemctl"
    | "systemd-detect-virt"
    | "vm_stat",
  cwd: string,
  args: ReadonlyArray<string>,
) {
  return execute(tool, cwd, args, tool === "git" ? [...gitConfigArgs, ...args] : args);
}

export function runExecutable(executable: string, args: ReadonlyArray<string>) {
  return execute(executable, homedir(), args, args);
}

export function runGit(cwd: string, args: ReadonlyArray<string>) {
  return runTool("git", cwd, args);
}

const actionTimeout = Duration.minutes(30);
const errorLines = 5;

export function lastLines(text: string): string {
  return text
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .slice(-errorLines)
    .join("\n");
}

export function runGitAction(options: {
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
  readonly onOutput: (text: string) => void;
  readonly environment?: Readonly<Record<string, string>>;
  readonly input?: string;
}) {
  const args = [...gitConfigArgs, "-c", "core.askPass=", ...options.args];

  return Effect.callback<void, CommandFailed>((resume) => {
    let errorOutput = "";
    let exited = false;

    const child = spawn("git", args, {
      cwd: options.cwd,
      env: { ...actionEnvironment, ...options.environment },
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdin.on("error", () => {});
    child.stdin.end(options.input ?? "");

    const closed = new Promise<void>((settle) => {
      child.once("close", () => {
        exited = true;
        settle();
      });
    });

    const fail = (message: string) =>
      resume(Effect.fail(new CommandFailed({ args, cwd: options.cwd, message })));

    child.stdout.setEncoding("utf8").on("data", options.onOutput);
    child.stderr.setEncoding("utf8").on("data", (text: string) => {
      errorOutput = `${errorOutput}${text}`.slice(-4096);
      options.onOutput(text);
    });
    child.on("error", (error) => fail(error.message));
    child.on("close", (code, exitSignal) => {
      if (code === 0) {
        resume(Effect.void);

        return;
      }

      fail(
        redactCredentials(lastLines(errorOutput)) ||
          `git exited with ${code === null ? `signal ${exitSignal}` : `code ${code}`}`,
      );
    });

    return Effect.promise(() => {
      if (!exited && child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGTERM");
          // oxlint-disable-next-line eslint/no-empty -- The process group has already exited.
        } catch {}
      }

      return closed;
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: actionTimeout,
      orElse: () =>
        Effect.fail(
          new CommandFailed({
            args,
            cwd: options.cwd,
            message: `Git took longer than ${Duration.format(actionTimeout)} and was stopped.`,
          }),
        ),
    }),
  );
}

export type ProgramResult =
  | {
      readonly _tag: "Exited";
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
      readonly output: string;
    }
  | { readonly _tag: "TimedOut"; readonly output: string };

const capturedOutputCharacters = 16 * 1024;
const outputGrace = Duration.seconds(1);
const defaultStopGrace = Duration.seconds(5);
const killGrace = Duration.seconds(1);
const groupPollInterval = Duration.millis(100);

interface ProgramExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export function runProgram(options: {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly timeout: Duration.Duration;
  readonly stopGrace?: Duration.Duration;
}) {
  const cwd = homedir();
  const stopGrace = options.stopGrace ?? defaultStopGrace;

  return Effect.gen(function* () {
    const exited = Deferred.makeUnsafe<ProgramExit, CommandFailed>();
    const closed = Deferred.makeUnsafe<void>();
    let output = "";
    const deadline = { passed: false };

    const child = spawn(options.executable, options.args, {
      cwd,
      env: inheritedEnvironment(),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const capture = (text: string) => {
      output = `${output}${text}`.slice(-capturedOutputCharacters);
    };

    child.stdout.setEncoding("utf8").on("data", capture);
    child.stderr.setEncoding("utf8").on("data", capture);
    child.on("error", (error) =>
      Deferred.doneUnsafe(
        exited,
        Effect.fail(new CommandFailed({ args: options.args, cwd, message: error.message })),
      ),
    );
    child.on("exit", (code, signal) =>
      Deferred.doneUnsafe(exited, Effect.succeed({ code, signal })),
    );
    child.on("close", () => Deferred.doneUnsafe(closed, Effect.void));

    const signalGroup = (signal: NodeJS.Signals | 0) => {
      if (child.pid === undefined) {
        return false;
      }

      try {
        process.kill(-child.pid, signal);

        return true;
      } catch (error) {
        if (Predicate.hasProperty(error, "code") && error.code === "ESRCH") {
          return false;
        }

        throw error;
      }
    };

    const groupGone = (limit: Duration.Duration) =>
      Effect.sleep(groupPollInterval).pipe(
        Effect.andThen(Effect.sync(() => !signalGroup(0))),
        Effect.repeat({ until: (gone) => gone }),
        Effect.timeoutOption(limit),
      );

    const stopping = yield* Effect.gen(function* () {
      yield* Effect.sleep(options.timeout);

      const terminated = yield* Effect.sync(() => {
        deadline.passed =
          child.exitCode === null && child.signalCode === null && signalGroup("SIGTERM");

        return deadline.passed;
      });

      if (terminated && Option.isNone(yield* groupGone(stopGrace))) {
        signalGroup("SIGKILL");
        yield* groupGone(killGrace);
      }
    }).pipe(Effect.forkDetach);

    const exit = yield* Deferred.await(exited);

    yield* deadline.passed ? Fiber.join(stopping) : Fiber.interrupt(stopping);

    yield* Deferred.await(closed).pipe(Effect.timeoutOption(outputGrace));

    const captured = redactCredentials(output);

    return deadline.passed
      ? ({ _tag: "TimedOut", output: captured } satisfies ProgramResult)
      : ({ _tag: "Exited", ...exit, output: captured } satisfies ProgramResult);
  });
}
