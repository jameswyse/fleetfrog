import { execFile, spawn } from "node:child_process";

import { Duration, Effect, Schema } from "effect";

import { redactCredentials } from "./redactCredentials.ts";

export class CommandFailed extends Schema.TaggedError<CommandFailed>()("CommandFailed", {
  args: Schema.Array(Schema.String),
  cwd: Schema.String,
  message: Schema.String,
}) {}

const gitConfigArgs = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"];

const toolEnvironment = {
  ...process.env,
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

export function runTool(
  tool:
    | "git"
    | "gh"
    | "ioreg"
    | "launchctl"
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
  return Effect.callback<string, CommandFailed>((resume, signal) => {
    execFile(
      tool,
      tool === "git" ? [...gitConfigArgs, ...args] : args,
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

export function runGit(cwd: string, args: ReadonlyArray<string>) {
  return runTool("git", cwd, args);
}

const actionTimeout = Duration.minutes(30);
const errorLines = 5;

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

      const lastLines = errorOutput
        .split(/[\r\n]+/)
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .slice(-errorLines)
        .join("\n");

      fail(
        redactCredentials(lastLines) ||
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
