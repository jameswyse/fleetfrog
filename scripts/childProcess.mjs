import { spawn } from "node:child_process";

export async function runChild(command, arguments_) {
  const child = spawn(command, arguments_, {
    env: process.env,
    stdio: "inherit",
  });

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => resolve({ exitCode, signal }));
  });
}

function requirePnpmContext() {
  if (!process.env.npm_execpath) {
    throw new Error("This command must be run through pnpm.");
  }
}

export function runWorkspaceBinary(command, arguments_) {
  requirePnpmContext();

  return runChild(command, arguments_);
}

export function runPnpm(arguments_) {
  const pnpmCliPath = process.env.npm_execpath;

  requirePnpmContext();

  return runChild(process.execPath, [pnpmCliPath, ...arguments_]);
}

export function mirrorChildResult(result) {
  if (result.signal) {
    process.kill(process.pid, result.signal);
  } else {
    process.exitCode = result.exitCode ?? 1;
  }
}
