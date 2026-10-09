import { Effect, Schema } from "effect";

import { Count } from "./count.ts";
import { ReportedList, ReportedText } from "./reported.ts";

export const T3CodeSchema = Schema.Struct({ migration: Schema.Int, name: ReportedText });
export type T3CodeSchema = typeof T3CodeSchema.Type;

export const supportedT3CodeSchema: T3CodeSchema = {
  migration: 60,
  name: "ThreadSnapshotWindowIndexes",
};

export function schemaDrift(schema: T3CodeSchema): "Current" | "Newer" | "Older" {
  if (schema.migration === supportedT3CodeSchema.migration) {
    return "Current";
  }

  return schema.migration > supportedT3CodeSchema.migration ? "Newer" : "Older";
}

export const ProjectIconColor = Schema.Literals([
  "gray",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
]);
export type ProjectIconColor = typeof ProjectIconColor.Type;

export const ProjectIcon = Schema.TaggedUnion({
  Lucide: { name: ReportedText, color: ProjectIconColor },
  Emoji: { emoji: ReportedText },
  Monogram: { text: ReportedText, color: ProjectIconColor },
  Image: { id: ReportedText },
});
export type ProjectIcon = typeof ProjectIcon.Type;

export const T3CodeProject = Schema.Struct({
  id: ReportedText,
  title: ReportedText,
  path: ReportedText,
  icon: Schema.NullOr(ProjectIcon),
  autoPull: Schema.Boolean,
  updatedAt: Schema.DateTimeUtc,
});
export type T3CodeProject = typeof T3CodeProject.Type;

export const T3CodeThreadState = Schema.Literals(["Working", "Waiting", "Idle"]);
export type T3CodeThreadState = typeof T3CodeThreadState.Type;

export const T3CodeThread = Schema.Struct({
  id: ReportedText,
  projectId: ReportedText,
  title: ReportedText,
  path: ReportedText,
  worktree: Schema.Boolean,
  state: T3CodeThreadState,
  archived: Schema.Boolean,
  updatedAt: Schema.DateTimeUtc,
});
export type T3CodeThread = typeof T3CodeThread.Type;

export const T3CodeReading = Schema.TaggedUnion({
  NotFound: {},
  Unreadable: { message: ReportedText, schema: Schema.NullOr(T3CodeSchema) },
  Read: {
    schema: T3CodeSchema,
    projects: ReportedList(T3CodeProject),
    threads: ReportedList(T3CodeThread),
    threadCount: Count,
    unreadRecords: Count,
  },
});
export type T3CodeReading = typeof T3CodeReading.Type;

export const T3CodeServer = Schema.Struct({
  version: Schema.NullOr(ReportedText),
  startedAt: Schema.DateTimeUtc,
  port: Schema.Int,
});
export type T3CodeServer = typeof T3CodeServer.Type;

export const T3CodeProvider = Schema.Struct({
  name: ReportedText,
  version: Schema.NullOr(ReportedText),
  latestVersion: Schema.NullOr(ReportedText),
  ready: Schema.Boolean,
  signedIn: Schema.Boolean,
});
export type T3CodeProvider = typeof T3CodeProvider.Type;

export const T3CodeStatus = Schema.Struct({
  database: ReportedText,
  reading: T3CodeReading,
  server: Schema.NullOr(T3CodeServer).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(null))),
  providers: ReportedList(T3CodeProvider).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed([])),
  ),
});
export type T3CodeStatus = typeof T3CodeStatus.Type;

export const T3CodeSettings = Schema.Struct({
  enabled: Schema.Boolean,
  projectAppearance: Schema.Boolean,
  discoverProjects: Schema.Boolean,
});
export type T3CodeSettings = typeof T3CodeSettings.Type;

export const IntegrationSettings = Schema.Struct({ t3Code: T3CodeSettings });
export type IntegrationSettings = typeof IntegrationSettings.Type;

export const defaultIntegrationSettings: IntegrationSettings = {
  t3Code: { enabled: true, projectAppearance: true, discoverProjects: true },
};
