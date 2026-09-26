import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { Effect } from "effect";

import type { ActionOutcome, ActionRequest, Tier } from "@fleetfrog/protocol/domain/action";
import type { RunId } from "@fleetfrog/protocol/domain/activity";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";

/**
 * Something this machine did or allowed, recorded locally where the hub cannot change it. Only
 * requested actions and changes are recorded, never scans or connections.
 */
export type AuditEntry =
  | { readonly event: "ActionStarted"; readonly runId: RunId; readonly request: ActionRequest }
  | { readonly event: "ActionFinished"; readonly runId: RunId; readonly outcome: ActionOutcome }
  /** The agent stopped before it could report, usually because the hub connection dropped. */
  | { readonly event: "ActionInterrupted"; readonly runId: RunId }
  /** Refused before it could change anything: not allowed, or not something this agent knows. */
  | {
      readonly event: "ActionRefused";
      readonly runId: RunId;
      readonly request: ActionRequest;
      readonly reason: string;
    }
  /** A project folder the hub asked for, created because it was missing. */
  | { readonly event: "FolderCreated"; readonly path: string }
  | { readonly event: "PolicyChanged"; readonly allowedTiers: ReadonlyArray<Tier> }
  | { readonly event: "Paired"; readonly agentUrl: string; readonly machineId: MachineId };

/** At this size the log moves to `actions.log.1`, replacing the previous one. */
const rotateAtBytes = 1024 * 1024;

export function auditLogPath(): string {
  const directory =
    process.platform === "darwin"
      ? path.join(homedir(), "Library", "Logs", "FleetFrog")
      : path.join(
          process.env.XDG_STATE_HOME ?? path.join(homedir(), ".local", "state"),
          "fleetfrog",
        );

  return path.join(directory, "actions.log");
}

async function append(file: string, line: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });

  const size = await stat(file).then(
    ({ size: bytes }) => bytes,
    () => 0,
  );

  if (size >= rotateAtBytes) {
    await rename(file, `${file}.1`);
  }

  await appendFile(file, line, { mode: 0o600 });
}

/**
 * The URL without a password, or without any credentials for HTTP. The hub is expected to send
 * clean URLs, but the log is written before the agent checks them.
 */
function withoutCredentials(remoteUrl: string): string {
  if (!remoteUrl.includes("://") || !URL.canParse(remoteUrl)) {
    return remoteUrl;
  }

  const url = new URL(remoteUrl);

  url.password = "";

  if (url.protocol === "https:" || url.protocol === "http:") {
    url.username = "";
  }

  return url.href;
}

function loggable(entry: AuditEntry): AuditEntry {
  if (
    (entry.event === "ActionStarted" || entry.event === "ActionRefused") &&
    entry.request._tag === "Clone"
  ) {
    return { ...entry, request: { ...entry.request, url: withoutCredentials(entry.request.url) } };
  }

  return entry;
}

/** Appends one JSON line. A log that cannot be written is reported but never stops an action. */
export function writeAuditEntry(entry: AuditEntry): Effect.Effect<void> {
  const file = auditLogPath();

  return Effect.tryPromise(() =>
    append(file, `${JSON.stringify({ at: new Date().toISOString(), ...loggable(entry) })}\n`),
  ).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not write the audit log", cause).pipe(Effect.annotateLogs({ file })),
    ),
  );
}
