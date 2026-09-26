import { execFile } from "node:child_process";

import { Data, Effect } from "effect";

export class CommandFailed extends Data.TaggedError("CommandFailed")<{
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly message: string;
}> {}

// Git status reads must not take the index lock and race the developer's own Git commands.
const gitEnvironment = {
  ...process.env,
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
};

/** Runs a command-line tool in a directory and returns its standard output. */
export function runCommand(
  tool: "git" | "gh" | "scutil" | "systemctl" | "launchctl",
  cwd: string,
  args: ReadonlyArray<string>,
) {
  return Effect.callback<string, CommandFailed>((resume, signal) => {
    execFile(
      tool,
      args,
      {
        cwd,
        env: gitEnvironment,
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
  return runCommand("git", cwd, args);
}
