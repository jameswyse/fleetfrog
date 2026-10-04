import { spawn } from "node:child_process";
import { once } from "node:events";

import { runCommand, startEnvironment } from "./environment.ts";

const pnpmPath = process.env.npm_execpath;

if (pnpmPath === undefined) {
  throw new Error("Run this command through pnpm test:e2e.");
}

const controller = new AbortController();
const interrupt = () => controller.abort("SIGINT");
const terminate = () => controller.abort("SIGTERM");

process.once("SIGINT", interrupt);
process.once("SIGTERM", terminate);

let environment: Awaited<ReturnType<typeof startEnvironment>> | undefined;

try {
  await runCommand(
    pnpmPath,
    ["build", "--filter=@fleetfrog/web", "--filter=@fleetfrog/agent-rs"],
    process.env,
    controller.signal,
  );
  environment = await startEnvironment(controller.signal);
  process.stdout.write(`E2E dashboard: ${environment.url}\n`);
  process.stdout.write(`E2E sandbox retained at: ${environment.directory}\n`);

  if (process.argv.includes("--serve")) {
    process.stdout.write("Press Ctrl+C to stop the test hub and agent. The files will be kept.\n");
    await once(controller.signal, "abort");
  } else {
    const runner = spawn(pnpmPath, ["exec", "e2e", "run", ...process.argv.slice(2)], {
      env: {
        ...process.env,
        FLEETFROG_E2E_DIR: environment.directory,
        FLEETFROG_E2E_URL: environment.url,
        E2E_TELEMETRY_DISABLED: "1",
      },
      stdio: "inherit",
      signal: controller.signal,
    });

    const code = await new Promise<number | null>((resolve, reject) => {
      runner.once("error", reject);
      runner.once("exit", resolve);
    });

    process.exitCode = code ?? 1;
  }
} catch (error) {
  if (!controller.signal.aborted) {
    throw error;
  }
} finally {
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", terminate);
  await environment?.close();

  if (controller.signal.aborted) {
    process.exitCode = controller.signal.reason === "SIGINT" ? 130 : 143;
  }
}
