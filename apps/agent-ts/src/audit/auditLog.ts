import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { DateTime, Effect } from "effect";

import { instanceNamed } from "../config/agentInstance.ts";

import type { ActionOutcome, ActionRequest, Tier } from "@fleetfrog/protocol/domain/action";
import type { RunId } from "@fleetfrog/protocol/domain/activity";
import type { MachineId } from "@fleetfrog/protocol/domain/machine";

export type AuditEntry =
  | { readonly event: "ActionStarted"; readonly runId: RunId; readonly request: ActionRequest }
  | { readonly event: "ActionFinished"; readonly runId: RunId; readonly outcome: ActionOutcome }
  | { readonly event: "ActionInterrupted"; readonly runId: RunId }
  | {
      readonly event: "ActionRefused";
      readonly runId: RunId;
      readonly request: ActionRequest;
      readonly reason: string;
    }
  | { readonly event: "FolderCreated"; readonly path: string }
  | { readonly event: "PolicyChanged"; readonly allowedTiers: ReadonlyArray<Tier> }
  | {
      readonly event: "PolicyDefaultsApplied";
      readonly allowedTiers: ReadonlyArray<Tier>;
      readonly deniedTiers: ReadonlyArray<Tier>;
    }
  | { readonly event: "Paired"; readonly agentUrl: string; readonly machineId: MachineId };

const rotateAtBytes = 1024 * 1024;

export function auditLogPath(): string {
  const directory =
    process.platform === "darwin"
      ? path.join(homedir(), "Library", "Logs", instanceNamed("FleetFrog"))
      : path.join(
          process.env.XDG_STATE_HOME ?? path.join(homedir(), ".local", "state"),
          instanceNamed("fleetfrog"),
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

export function writeAuditEntry(entry: AuditEntry): Effect.Effect<void> {
  const file = auditLogPath();

  return DateTime.now.pipe(
    Effect.flatMap((at) =>
      Effect.tryPromise(() =>
        append(file, `${JSON.stringify({ at: DateTime.formatIso(at), ...loggable(entry) })}\n`),
      ),
    ),
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not write the audit log", cause).pipe(Effect.annotateLogs({ file })),
    ),
  );
}
