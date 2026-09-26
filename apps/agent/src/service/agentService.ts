import { realpathSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import path from "node:path";

import { Effect } from "effect";

import { runCommand } from "../process/runCommand.ts";

const systemdUnitName = "fleetfrog.service";
const launchdLabel = "net.fleetfrog.agent";

/** The command that starts this agent, pinned to the current Node binary and script. */
function agentCommand(): ReadonlyArray<string> {
  const script = process.argv[1];

  if (script === undefined) {
    throw new Error("Cannot tell which script started the agent.");
  }

  return [process.execPath, realpathSync(script), "run"];
}

function systemdUnitPath(): string {
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"),
    "systemd",
    "user",
    systemdUnitName,
  );
}

function launchdPlistPath(): string {
  return path.join(homedir(), "Library", "LaunchAgents", `${launchdLabel}.plist`);
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

function systemdUnit(): string {
  return `[Unit]
Description=FleetFrog agent
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${agentCommand().map(quoteSystemdArgument).join(" ")}
Environment=${quoteSystemdArgument(`PATH=${process.env.PATH ?? ""}`)}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`;
}

function launchdPlist(): string {
  const logPath = path.join(homedir(), "Library", "Logs", "fleetfrog-agent.log");
  const argumentsXml = agentCommand()
    .map((argument) => `    <string>${escapeXml(argument)}</string>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${launchdLabel}</string>
  <key>ProgramArguments</key>
  <array>
${argumentsXml}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${escapeXml(process.env.PATH ?? "")}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>
</dict>
</plist>
`;
}

const launchdDomain = () => `gui/${userInfo().uid}`;

/** Installs and starts the agent as a per-user background service. Returns where it was written. */
export const installService = Effect.gen(function* () {
  const home = homedir();

  if (process.platform === "darwin") {
    const plistPath = launchdPlistPath();

    yield* Effect.promise(async () => {
      await mkdir(path.dirname(plistPath), { recursive: true });
      await writeFile(plistPath, launchdPlist());
    });
    // Replaces an already loaded copy; failing here only means none was loaded.
    yield* runCommand("launchctl", home, ["bootout", launchdDomain(), plistPath]).pipe(
      Effect.ignore,
    );
    yield* runCommand("launchctl", home, ["bootstrap", launchdDomain(), plistPath]);

    return plistPath;
  }

  const unitPath = systemdUnitPath();

  yield* Effect.promise(async () => {
    await mkdir(path.dirname(unitPath), { recursive: true });
    await writeFile(unitPath, systemdUnit());
  });
  yield* runCommand("systemctl", home, ["--user", "daemon-reload"]);
  yield* runCommand("systemctl", home, ["--user", "enable", "--now", systemdUnitName]);
  // Picks up a changed unit when the service was already running.
  yield* runCommand("systemctl", home, ["--user", "restart", systemdUnitName]);

  return unitPath;
});

/** Stops the background service and removes its definition. */
export const uninstallService = Effect.gen(function* () {
  const home = homedir();

  if (process.platform === "darwin") {
    const plistPath = launchdPlistPath();

    yield* runCommand("launchctl", home, ["bootout", launchdDomain(), plistPath]).pipe(
      Effect.ignore,
    );
    yield* Effect.promise(() => unlink(plistPath).catch(() => undefined));

    return plistPath;
  }

  const unitPath = systemdUnitPath();

  yield* runCommand("systemctl", home, ["--user", "disable", "--now", systemdUnitName]).pipe(
    Effect.ignore,
  );
  yield* Effect.promise(() => unlink(unitPath).catch(() => undefined));
  yield* runCommand("systemctl", home, ["--user", "daemon-reload"]);

  return unitPath;
});
