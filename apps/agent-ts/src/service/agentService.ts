import {
  copyFileSync,
  existsSync,
  fstatSync,
  ftruncateSync,
  realpathSync,
  statSync,
} from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import path from "node:path";

import { Effect, Logger, Schema } from "effect";

import { isMissingFile } from "../config/agentConfig.ts";
import { currentInstance, instanceNamed, instanceVariable } from "../config/agentInstance.ts";
import { runTool } from "../process/runTool.ts";

export class ServiceFileFailed extends Schema.TaggedError<ServiceFileFailed>()(
  "ServiceFileFailed",
  { path: Schema.String, message: Schema.String },
) {}

function serviceFile(file: string, write: () => Promise<void>) {
  return Effect.tryPromise({
    try: write,
    catch: (error) => new ServiceFileFailed({ path: file, message: String(error) }),
  });
}

const systemdUnitName = () => `${instanceNamed("fleetfrog")}.service`;
const launchdLabel = () => instanceNamed("net.fleetfrog.agent");

/**
 * The Node binary the service starts. pnpm links the Node a checkout's `devEngines` names at
 * `node_modules/.bin/node` and moves the link when that version changes, so a service started
 * through the link survives a Node upgrade. Any other Node is used as it is.
 */
function serviceNode(script: string): string {
  const current = realpathSync(process.execPath);

  for (let directory = path.dirname(script); ; directory = path.dirname(directory)) {
    const link = path.join(directory, "node_modules", ".bin", "node");

    if (existsSync(link) && realpathSync(link) === current) {
      return link;
    }

    if (path.dirname(directory) === directory) {
      return process.execPath;
    }
  }
}

/** The command that starts this agent, pinned to its Node and script. */
function agentCommand(): ReadonlyArray<string> {
  const script = process.argv[1];

  if (script === undefined) {
    throw new Error("Cannot tell which script started the agent.");
  }

  const resolved = realpathSync(script);

  return [serviceNode(resolved), resolved, "run"];
}

function systemdUnitPath(): string {
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"),
    "systemd",
    "user",
    systemdUnitName(),
  );
}

function launchdPlistPath(): string {
  return path.join(homedir(), "Library", "LaunchAgents", `${launchdLabel()}.plist`);
}

function quoteSystemdArgument(argument: string): string {
  return `"${argument.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * The variables the service starts the agent with: the `PATH` it was installed from, so it finds
 * the same Git, and the instance's name, so it reads that instance's files.
 */
function serviceEnvironment(): ReadonlyArray<readonly [string, string]> {
  const instance = currentInstance();

  return [
    ["PATH", process.env.PATH ?? ""],
    ...(instance === undefined ? [] : [[instanceVariable, instance] as const]),
  ];
}

function systemdUnit(): string {
  const instance = currentInstance();

  const environment = serviceEnvironment()
    .map(([name, value]) => `Environment=${quoteSystemdArgument(`${name}=${value}`)}`)
    .join("\n");

  return `[Unit]
Description=${instance === undefined ? "FleetFrog agent" : `FleetFrog agent (${instance})`}
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${agentCommand().map(quoteSystemdArgument).join(" ")}
${environment}
Restart=on-failure
RestartSec=10
# Stopping with SIGTERM interrupts the agent, which then exits with 130.
SuccessExitStatus=130

[Install]
WantedBy=default.target
`;
}

/** Where launchd writes the agent's output on macOS. On Linux the journal keeps it. */
function launchdLogPath(): string {
  return path.join(homedir(), "Library", "Logs", `${instanceNamed("fleetfrog-agent")}.log`);
}

/** At this size the launchd log moves to `<log>.1`, replacing the previous one. */
const rotateLogAtBytes = 1024 * 1024;

/**
 * Rotates the launchd log once it is too big, when this process's output goes there. launchd has
 * no rotation of its own and opens the log once, in append mode, so the agent keeps a copy and
 * empties the file in place, and later lines start again at its beginning.
 */
function rotateLog(): void {
  if (process.platform !== "darwin") {
    return;
  }

  const logPath = launchdLogPath();

  try {
    const open = fstatSync(process.stdout.fd);
    const stored = statSync(logPath);

    if (open.dev === stored.dev && open.ino === stored.ino && stored.size >= rotateLogAtBytes) {
      copyFileSync(logPath, `${logPath}.1`);
      ftruncateSync(process.stdout.fd, 0);
    }
  } catch {
    // Losing a rotation only leaves the log longer, which the next line retries.
  }
}

/** Adds a logger that rotates the launchd log after each line the other loggers write. */
export const logRotation = Logger.layer([Logger.make(rotateLog)], { mergeWithExisting: true });

function launchdPlist(): string {
  const logPath = launchdLogPath();

  const argumentsXml = agentCommand()
    .map((argument) => `    <string>${escapeXml(argument)}</string>`)
    .join("\n");

  const environmentXml = serviceEnvironment()
    .map(([name, value]) => `    <key>${name}</key>\n    <string>${escapeXml(value)}</string>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${launchdLabel()}</string>
  <key>ProgramArguments</key>
  <array>
${argumentsXml}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${environmentXml}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>
</dict>
</plist>
`;
}

function ignoreMissing(error: unknown): void {
  if (!isMissingFile(error)) {
    throw error;
  }
}

const launchdDomain = () => `gui/${userInfo().uid}`;

/** Installs and starts the agent as a per-user background service. Returns where it was written. */
export const installService = Effect.gen(function* () {
  const home = homedir();

  if (process.platform === "darwin") {
    const plistPath = launchdPlistPath();

    yield* serviceFile(plistPath, async () => {
      await mkdir(path.dirname(plistPath), { recursive: true });
      await writeFile(plistPath, launchdPlist());
    });
    // Replaces an already loaded copy; failing here only means none was loaded.
    yield* runTool("launchctl", home, ["bootout", launchdDomain(), plistPath]).pipe(Effect.ignore);
    yield* runTool("launchctl", home, ["bootstrap", launchdDomain(), plistPath]);

    return plistPath;
  }

  const unitPath = systemdUnitPath();

  yield* serviceFile(unitPath, async () => {
    await mkdir(path.dirname(unitPath), { recursive: true });
    await writeFile(unitPath, systemdUnit());
  });
  yield* runTool("systemctl", home, ["--user", "daemon-reload"]);
  yield* runTool("systemctl", home, ["--user", "enable", "--now", systemdUnitName()]);
  // Picks up a changed unit when the service was already running.
  yield* runTool("systemctl", home, ["--user", "restart", systemdUnitName()]);

  return unitPath;
});

export const uninstallService = Effect.gen(function* () {
  const home = homedir();

  if (process.platform === "darwin") {
    const plistPath = launchdPlistPath();

    yield* runTool("launchctl", home, ["bootout", launchdDomain(), plistPath]).pipe(Effect.ignore);
    yield* serviceFile(plistPath, () => unlink(plistPath).catch(ignoreMissing));

    return plistPath;
  }

  const unitPath = systemdUnitPath();

  yield* runTool("systemctl", home, ["--user", "disable", "--now", systemdUnitName()]).pipe(
    Effect.ignore,
  );
  yield* serviceFile(unitPath, () => unlink(unitPath).catch(ignoreMissing));
  yield* runTool("systemctl", home, ["--user", "daemon-reload"]);

  return unitPath;
});
