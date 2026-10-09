import { spawn } from "node:child_process";
import { createWriteStream, mkdtempSync, rmdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { freePort, stop } from "../e2e/environment.ts";

export const repository = fileURLToPath(new URL("../../", import.meta.url));

export async function startDemoHub(options: {
  readonly signal: AbortSignal;
  readonly port?: number;
}): Promise<{ readonly url: string; readonly log: string; readonly close: () => Promise<void> }> {
  const port = options.port ?? (await freePort());
  const url = `http://127.0.0.1:${port}`;
  const log = path.join(mkdtempSync(path.join(tmpdir(), "fleetfrog-demo-")), "hub.log");
  const output = createWriteStream(log);
  const environment: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("FLEETFROG_")) {
      environment[key] = value;
    }
  }

  const hub = spawn(process.execPath, ["apps/hub/src/main.ts"], {
    cwd: repository,
    env: {
      ...environment,
      FLEETFROG_DEMO: "1",
      FLEETFROG_HOST: "127.0.0.1",
      FLEETFROG_DASHBOARD_PORT: String(port),
      FLEETFROG_WEB_ROOT: path.join(repository, "apps/web/dist"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    signal: options.signal,
  });

  hub.stdout.pipe(output, { end: false });
  hub.stderr.pipe(output, { end: false });
  hub.once("close", () => output.end());
  hub.once("error", (error) => output.write(`${error.message}\n`));

  const close = async () => {
    await stop(hub);
    rmSync(log, { force: true });
    rmdirSync(path.dirname(log));
  };

  const deadline = Date.now() + 30_000;

  try {
    for (;;) {
      options.signal.throwIfAborted();

      if (hub.exitCode !== null || hub.signalCode !== null) {
        throw new Error(`The demo hub stopped during startup. See ${log}`);
      }

      try {
        const response = await fetch(`${url}/auth/session`, {
          signal: AbortSignal.any([options.signal, AbortSignal.timeout(1_000)]),
        });

        if (response.ok) {
          return { url, log, close };
        }
        // oxlint-disable-next-line eslint/no-empty -- The hub has started but its HTTP listener isn't ready yet.
      } catch {}

      if (Date.now() >= deadline) {
        throw new Error(`The demo hub didn't start within 30 seconds. See ${log}`);
      }

      await setTimeout(100, undefined, { signal: options.signal });
    }
  } catch (error) {
    await stop(hub);
    throw error;
  }
}
