import { Effect, Schema } from "effect";

import { Commit, Operation } from "./checkout.ts";
import { Count } from "./count.ts";
import { ReportedList, ReportedText } from "./reported.ts";
import { RepositoryIdentity } from "./repositoryIdentity.ts";

export const TrashId = Schema.String.pipe(Schema.check(Schema.isUUID()), Schema.brand("TrashId"));
export type TrashId = typeof TrashId.Type;

export const TrashedCheckout = Schema.Struct({
  id: TrashId,
  originalPath: ReportedText,
  identity: RepositoryIdentity,
  directoryName: ReportedText,
  branch: Schema.NullOr(ReportedText),
  lastCommit: Schema.NullOr(Commit),
  trashedAt: Schema.DateTimeUtc,
  sizeBytes: Count,
  worktrees: ReportedList(
    Schema.Struct({ originalPath: ReportedText, trashedPath: ReportedText }),
  ).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
});
export type TrashedCheckout = typeof TrashedCheckout.Type;

export const SizedPath = Schema.Struct({ path: ReportedText, sizeBytes: Count });
export type SizedPath = typeof SizedPath.Type;

export const RemoteCheck = Schema.TaggedUnion({
  Fetched: {},
  NoRemote: {},
  Unreachable: { message: ReportedText },
});
export type RemoteCheck = typeof RemoteCheck.Type;

export const Inspection = Schema.Struct({
  fingerprint: ReportedText,
  sizeBytes: Count,
  remote: RemoteCheck,
  unpushedBranches: ReportedList(Schema.Struct({ name: ReportedText, commits: Count })),
  unpushedCommits: Count,
  unpushedTags: Count,
  operation: Schema.NullOr(Operation),
  submodules: Count,
  stashes: Count,
  changedFiles: Count,
  untrackedFiles: Count,
  ignored: Schema.Struct({ items: ReportedList(SizedPath), total: Count }),
  caches: ReportedList(SizedPath),
  linkedWorktrees: Count,
});
export type Inspection = typeof Inspection.Type;

export const WorktreeInspection = Schema.Struct({
  fingerprint: ReportedText,
  path: ReportedText,
  missing: Schema.NullOr(Schema.Struct({ parentMissing: Schema.Boolean })),
  branch: Schema.NullOr(ReportedText),
  locked: Schema.NullOr(ReportedText),
  changedFiles: Count,
  untrackedFiles: Count,
  unreachableCommits: Count,
  ignored: Schema.Struct({ items: ReportedList(SizedPath), total: Count }),
  caches: ReportedList(SizedPath),
});
export type WorktreeInspection = typeof WorktreeInspection.Type;

export const InspectionResult = Schema.TaggedUnion({
  Inspected: { inspection: Inspection },
  WorktreeInspected: { inspection: WorktreeInspection },
  Failed: { message: ReportedText },
});
export type InspectionResult = typeof InspectionResult.Type;

export function nothingUnique(inspection: Inspection): boolean {
  return (
    inspection.remote._tag === "Fetched" &&
    inspection.unpushedCommits === 0 &&
    inspection.unpushedTags === 0 &&
    inspection.operation === null &&
    inspection.submodules === 0 &&
    inspection.stashes === 0 &&
    inspection.changedFiles === 0 &&
    inspection.untrackedFiles === 0 &&
    inspection.ignored.total === 0
  );
}
