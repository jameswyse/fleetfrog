import { mkdir, stat } from "node:fs/promises";

import { Effect } from "effect";

import { checkFolderPath } from "@fleetfrog/protocol/domain/cloneDestination";
import { FolderOutcome } from "@fleetfrog/protocol/domain/fleet";

import type { Tier } from "@fleetfrog/protocol/domain/action";

import type { AuditEntry } from "../audit/auditLog.ts";
import type { ConfigUnavailable } from "../config/agentConfig.ts";
import type { AgentPolicy } from "../config/agentPolicy.ts";

const pathProblems = {
  NotAbsolute: "It isn't a full path.",
  Hidden: "It's a hidden folder, or its path has . or .. segments.",
} as const;

function failed(message: string): FolderOutcome {
  return FolderOutcome.cases.Failed.make({ message });
}

/** The tier that covers creating the folder, or null when it's neither kind the hub may create. */
function folderTier(options: {
  readonly path: string;
  readonly roots: ReadonlyArray<string>;
  readonly archiveFolder: string | null;
}): Tier | null {
  if (options.roots.includes(options.path)) {
    return "git";
  }

  return options.path === options.archiveFolder ? "cleanup" : null;
}

/**
 * Creates one of this machine's project folders, or its Archive folder, when the hub asks, with
 * any missing parents. The path must be one the hub has set, and neither hidden nor reached through
 * `.` or `..`. A project folder belongs to the git tier, which covers the folders clones go into,
 * and the Archive folder to the cleanup tier, so an owner who has turned the tier off gets nothing
 * created. Only a folder actually made is audited.
 */
export const createProjectFolder = Effect.fn("createProjectFolder")(function* (options: {
  readonly path: string;
  /** The project folders as the hub last configured them. */
  readonly roots: ReadonlyArray<string>;
  /** The Archive folder as the hub last configured it. */
  readonly archiveFolder: string | null;
  readonly home: string;
  readonly loadPolicy: Effect.Effect<AgentPolicy, ConfigUnavailable>;
  readonly audit: (entry: AuditEntry) => Effect.Effect<void>;
}): Effect.fn.Return<FolderOutcome> {
  const tier = folderTier(options);

  if (tier === null) {
    return failed(
      `${options.path} isn't one of this machine's project folders or its Archive folder.`,
    );
  }

  const allowed = yield* options.loadPolicy.pipe(
    Effect.map(({ allowedTiers }) => allowedTiers.includes(tier)),
    Effect.orElseSucceed(() => false),
  );

  if (!allowed) {
    return failed(
      tier === "git"
        ? "Git actions are turned off on this machine, and they include creating project folders."
        : "Cleanup actions are turned off on this machine, and they include creating the Archive folder.",
    );
  }

  const check = checkFolderPath({ path: options.path, home: options.home });

  if (check._tag !== "Valid") {
    return failed(pathProblems[check._tag]);
  }

  const existing = yield* Effect.promise(() => stat(check.path).catch(() => null));

  if (existing !== null) {
    return existing.isDirectory()
      ? FolderOutcome.cases.AlreadyThere.make({})
      : failed(`Something other than a folder is already at ${check.path}.`);
  }

  return yield* Effect.tryPromise({
    try: () => mkdir(check.path, { recursive: true }),
    catch: (error) => (error instanceof Error ? error.message : String(error)),
  }).pipe(
    Effect.andThen(options.audit({ event: "FolderCreated", path: check.path })),
    Effect.as(FolderOutcome.cases.Created.make({})),
    Effect.catch((message) => Effect.succeed(failed(`Couldn't create ${check.path}: ${message}`))),
  );
});
