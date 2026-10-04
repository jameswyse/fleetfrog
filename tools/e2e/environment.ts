import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { Effect, Predicate, Schema, Stream } from "effect";

import { MachineId } from "../../packages/protocol/src/domain/machine.ts";
import { encodePairingString } from "../../packages/protocol/src/pairing/pairingString.ts";
import { withDashboard } from "./dashboard.ts";
import { startGitRemote } from "./gitRemote.ts";
import { createRepositories, fixturePaths, initialRepositoryCount } from "./repositories.ts";

import type { ChildProcess } from "node:child_process";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const agentBinary = path.join(repository, "apps/agent-rs/dist/fleetfrog");

async function freePort(): Promise<number> {
  const server = createServer();

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  if (address === null || Predicate.isString(address)) {
    throw new Error("Could not allocate an e2e port.");
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });

  return address.port;
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const exited = once(child, "exit");

  child.kill("SIGTERM");
  const deadline = setTimeout(5_000, "timeout", { ref: false });

  if ((await Promise.race([exited, deadline])) === "timeout") {
    child.kill("SIGKILL");
    await exited;
  }
}

export async function runCommand(
  executable: string,
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
): Promise<void> {
  const child = spawn(executable, arguments_, {
    cwd: repository,
    env: environment,
    stdio: "inherit",
    signal,
  });

  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });

  if (code !== 0) {
    throw new Error(`${executable} exited with ${child.signalCode ?? code}.`);
  }
}

export async function startEnvironment(signal: AbortSignal) {
  signal.throwIfAborted();
  const directory = mkdtempSync("/tmp/fleetfrog-e2e-");
  const fixtures = fixturePaths(directory);
  const children: ChildProcess[] = [];
  const dashboardPort = await freePort();
  const agentPort = await freePort();
  const url = `http://127.0.0.1:${dashboardPort}`;
  const agentUrl = `ws://127.0.0.1:${agentPort}`;
  const environment: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("FLEETFROG_") && !key.startsWith("GIT_")) {
      environment[key] = value;
    }
  }

  Object.assign(environment, {
    FLEETFROG_INSTANCE: "e2e",
    FLEETFROG_CONFIG_DIR: path.join(directory, "agent-config"),
    FLEETFROG_DATA_DIR: path.join(directory, "hub-data"),
    FLEETFROG_HOST: "127.0.0.1",
    FLEETFROG_DASHBOARD_PORT: String(dashboardPort),
    FLEETFROG_AGENT_PORT: String(agentPort),
    FLEETFROG_AGENT_URL: agentUrl,
    FLEETFROG_AGENT_TLS: "none",
    FLEETFROG_WEB_ROOT: path.join(repository, "apps/web/dist"),
    XDG_DATA_HOME: path.join(directory, "agent-data"),
    T3CODE_HOME: path.join(directory, "t3code"),
    GH_CONFIG_DIR: path.join(directory, "github"),
    GIT_CONFIG_GLOBAL: path.join(directory, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  });

  const start = (
    name: string,
    executable: string,
    arguments_: readonly string[],
    childEnvironment = environment,
  ) => {
    const logPath = path.join(directory, `${name}.log`);
    const log = createWriteStream(logPath);

    const child = spawn(executable, arguments_, {
      cwd: repository,
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });

    children.push(child);
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.once("close", () => log.end());
    child.once("error", (error) => log.write(`${error.message}\n`));

    return child;
  };

  let closing: Promise<void> | undefined;
  let gitRemote: Awaited<ReturnType<typeof startGitRemote>> | undefined;

  const close = () => {
    closing ??= (async () => {
      for (const child of children.toReversed()) {
        await stop(child);
      }

      await gitRemote?.close();
    })();

    return closing;
  };

  try {
    createRepositories(directory);
    gitRemote = await startGitRemote(directory);
    environment.GIT_SSL_CAINFO = gitRemote.certificate;
    const hub = start("hub", process.execPath, ["apps/hub/src/main.ts"]);
    const deadline = Date.now() + 30_000;

    let ready = false;

    while (!ready) {
      signal.throwIfAborted();

      if (hub.exitCode !== null || hub.signalCode !== null) {
        throw new Error(`Hub stopped during startup. See ${directory}/hub.log`);
      }

      try {
        const response = await fetch(`${url}/auth/session`, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(1_000)]),
        });

        if (response.ok) {
          ready = true;
        }
        // oxlint-disable-next-line eslint/no-empty -- The hub has started but its HTTP listener isn't ready yet.
      } catch {}

      if (!ready && Date.now() >= deadline) {
        throw new Error(`Hub did not start within 30 seconds. See ${directory}/hub.log`);
      }

      if (!ready) {
        await setTimeout(100, undefined, { signal });
      }
    }

    await withDashboard(
      url,
      (client) =>
        Effect.gen(function* () {
          for (const target of [
            {
              name: "E2E machine",
              prefix: "agent",
              roots: fixtures.projects,
              archive: fixtures.archive,
            },
            {
              name: "E2E clone machine",
              prefix: "second-agent",
              roots: fixtures.secondProjects,
              archive: path.join(directory, "second-archive"),
            },
          ]) {
            const targetEnvironment = {
              ...environment,
              FLEETFROG_CONFIG_DIR: path.join(directory, `${target.prefix}-config`),
              XDG_DATA_HOME: path.join(directory, `${target.prefix}-data`),
              XDG_STATE_HOME: path.join(directory, `${target.prefix}-state`),
              T3CODE_HOME: path.join(
                directory,
                target.prefix === "agent" ? "t3code" : "second-t3code",
              ),
            };

            const offer = yield* client.CreatePairingOffer();

            const invitation = encodePairingString({
              agentUrl,
              code: offer.code,
              certificateFingerprint: offer.certificateFingerprint,
            });

            yield* Effect.promise(() =>
              runCommand(agentBinary, ["pair", invitation], targetEnvironment, signal),
            );

            const configText = yield* Effect.sync(() =>
              readFileSync(path.join(directory, `${target.prefix}-config/agent.json`), "utf8"),
            );

            const config = yield* Schema.decodeEffect(
              Schema.fromJsonString(Schema.Struct({ machineId: MachineId })),
            )(configText);

            yield* client.SetDiscoveryRoots({
              machineId: config.machineId,
              roots: [target.roots],
            });
            yield* client.SetArchiveFolder({ machineId: config.machineId, folder: target.archive });
            yield* client.RenameMachine({ machineId: config.machineId, customName: target.name });
            yield* Effect.promise(() =>
              runCommand(agentBinary, ["deny", "update"], targetEnvironment, signal),
            );
            start(target.prefix, agentBinary, ["run"], targetEnvironment);
          }

          yield* client.UpdateIntegrations({
            integrations: {
              t3Code: { enabled: false, projectAppearance: false, discoverProjects: false },
            },
          });
          yield* client.UpdatePolling({
            polling: {
              idleStatusSeconds: 5,
              watchingStatusSeconds: 5,
              discoverySeconds: 5,
              githubSeconds: 3600,
            },
          });
        }),
      signal,
    );
    await withDashboard(
      url,
      (client) =>
        client.WatchFleet().pipe(
          Stream.filter(
            (fleet) =>
              fleet.machines.length === 2 &&
              fleet.machines.every((machine) => machine.connection._tag === "Online") &&
              fleet.repositories.length === initialRepositoryCount,
          ),
          Stream.take(1),
          Stream.runDrain,
        ),
      signal,
    );

    return { directory, url, close };
  } catch (error) {
    await close();
    throw new Error(`E2E environment failed. Logs and fixtures: ${directory}`, { cause: error });
  }
}
