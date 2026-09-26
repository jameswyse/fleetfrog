import { execFile, spawn } from "node:child_process";

import { Data, Duration, Effect } from "effect";

export class CommandFailed extends Data.TaggedError("CommandFailed")<{
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly message: string;
}> {}

// Git status reads must not take the index lock and race the developer's own Git commands. The
// same environment suits the other tools: no prompts and untranslated output.
const toolEnvironment = {
  ...process.env,
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
};

/**
 * Actions run Git without a terminal and must fail rather than wait for someone to answer a
 * prompt. With no askpass program, SSH can't ask for a passphrase or a new host key, and Git
 * Credential Manager is told not to open a window. Helpers that answer silently, such as a
 * keychain, still work.
 */
const promptPrograms = new Set(["GIT_ASKPASS", "SSH_ASKPASS"]);
const actionEnvironment = {
  ...Object.fromEntries(
    Object.entries(toolEnvironment).filter(([name]) => !promptPrograms.has(name)),
  ),
  SSH_ASKPASS_REQUIRE: "never",
  GCM_INTERACTIVE: "never",
};

/** Runs a command-line tool in a directory and returns its standard output. */
export function runTool(
  tool:
    | "git"
    | "gh"
    | "ioreg"
    | "launchctl"
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
      args,
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
                new CommandFailed({ args, cwd, message: stderr.trim() || error.message }),
              ),
        );
      },
    );
  });
}

export function runGit(cwd: string, args: ReadonlyArray<string>) {
  return runTool("git", cwd, args);
}

/** Git actions that take longer than this are stopped. A clone of a large repository fits. */
const actionTimeout = Duration.minutes(30);
const errorLines = 5;

/**
 * Runs Git for an action, passing its output to `onOutput` as it arrives. Git runs in its own
 * session with no terminal, so SSH fails instead of prompting, and with hooks disabled, so no
 * repository code runs. Interrupting stops Git and anything it started.
 */
export function runGitAction(options: {
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
  readonly onOutput: (text: string) => void;
  /** Extra variables, such as `GIT_ALLOW_PROTOCOL` for clones. */
  readonly environment?: Readonly<Record<string, string>>;
}) {
  const args = ["-c", "core.hooksPath=/dev/null", "-c", "core.askPass=", ...options.args];

  return Effect.callback<void, CommandFailed>((resume) => {
    let errorOutput = "";
    let exited = false;
    const child = spawn("git", args, {
      cwd: options.cwd,
      env: { ...actionEnvironment, ...options.environment },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
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
        lastLines || `git exited with ${code === null ? `signal ${exitSignal}` : `code ${code}`}`,
      );
    });

    // Interrupting signals the whole process group, which includes SSH, and waits for Git to
    // exit, so its locks are gone before the next action on the repository starts.
    return Effect.promise(() => {
      if (!exited && child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          // The group has already exited.
        }
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
