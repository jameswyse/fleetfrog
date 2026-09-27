import { Schema } from "effect";

import { Count } from "./count.ts";

/**
 * A version of T3 Code's database schema, named by its newest migration. T3 Code changes its schema
 * often and publishes no stable interface, so agents compare what they find with the version
 * FleetFrog was built against.
 */
export const T3CodeSchema = Schema.Struct({ migration: Schema.Int, name: Schema.String });
export type T3CodeSchema = typeof T3CodeSchema.Type;

/**
 * The schema FleetFrog reads. After checking that FleetFrog still reads a newer T3 Code correctly,
 * move this to its newest migration.
 */
export const supportedT3CodeSchema: T3CodeSchema = {
  migration: 54,
  name: "ProjectionThreadsAutoSettleDisabledAt",
};

/** How a machine's T3 Code schema compares with the one FleetFrog was built against. */
export function schemaDrift(schema: T3CodeSchema): "Current" | "Newer" | "Older" {
  if (schema.migration === supportedT3CodeSchema.migration) {
    return "Current";
  }

  return schema.migration > supportedT3CodeSchema.migration ? "Newer" : "Older";
}

/** The colours T3 Code offers for project icons. */
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

/** A project's icon in T3 Code: one picked there, or an image found in the repository. */
export const ProjectIcon = Schema.TaggedUnion({
  /** A Lucide icon by its kebab-case name, such as `git-branch`. */
  Lucide: { name: Schema.String, color: ProjectIconColor },
  Emoji: { emoji: Schema.String },
  Monogram: { text: Schema.String, color: ProjectIconColor },
  /** An image from the repository, served by the hub at `/project-icons/<id>`. */
  Image: { id: Schema.String },
});
export type ProjectIcon = typeof ProjectIcon.Type;

export const T3CodeProject = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  /** The folder T3 Code opens, which is usually a clone's main worktree. */
  path: Schema.String,
  icon: Schema.NullOr(ProjectIcon),
  /** T3 Code pulls the default branch itself. */
  autoPull: Schema.Boolean,
  updatedAt: Schema.DateTimeUtc,
});
export type T3CodeProject = typeof T3CodeProject.Type;

/**
 * What a thread's agent is doing. `Waiting` is part-way through a turn, stopped for an approval or
 * an answer.
 */
export const T3CodeThreadState = Schema.Literals(["Working", "Waiting", "Idle"]);
export type T3CodeThreadState = typeof T3CodeThreadState.Type;

export const T3CodeThread = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  title: Schema.String,
  /** The checkout the thread works in: its own worktree, or its project's folder. */
  path: Schema.String,
  /** Set when T3 Code made a worktree for the thread. */
  worktree: Schema.Boolean,
  state: T3CodeThreadState,
  archived: Schema.Boolean,
  updatedAt: Schema.DateTimeUtc,
});
export type T3CodeThread = typeof T3CodeThread.Type;

export const T3CodeReading = Schema.TaggedUnion({
  /** The machine has no T3 Code database where T3 Code keeps it. */
  NotFound: {},
  /**
   * The database couldn't be read, or lacks something FleetFrog reads. `schema` is null when even
   * the version couldn't be read.
   */
  Unreadable: { message: Schema.String, schema: Schema.NullOr(T3CodeSchema) },
  /** Projects T3 Code still has, and the threads of theirs that FleetFrog shows. */
  Read: {
    schema: T3CodeSchema,
    projects: Schema.Array(T3CodeProject),
    /**
     * Threads in progress, threads with their own worktree, and others changed in the last two
     * weeks, newest first.
     */
    threads: Schema.Array(T3CodeThread),
    /** Every thread that isn't archived or deleted. */
    threadCount: Count,
    /**
     * Projects, threads and icons T3 Code stored in a form this agent can't read, which are left
     * out or shown without their icon. More than none means T3 Code's data has changed shape.
     */
    unreadRecords: Count,
  },
});
export type T3CodeReading = typeof T3CodeReading.Type;

/** What an agent last found in its machine's T3 Code database, which it reads on every scan. */
export const T3CodeStatus = Schema.Struct({
  /** Where the agent looked. */
  database: Schema.String,
  reading: T3CodeReading,
});
export type T3CodeStatus = typeof T3CodeStatus.Type;

export const T3CodeSettings = Schema.Struct({
  enabled: Schema.Boolean,
  /** Show T3 Code's project names and icons in place of repository names. */
  projectAppearance: Schema.Boolean,
  /** Find repositories T3 Code has as projects outside the machines' project folders. */
  discoverProjects: Schema.Boolean,
});
export type T3CodeSettings = typeof T3CodeSettings.Type;

export const IntegrationSettings = Schema.Struct({ t3Code: T3CodeSettings });
export type IntegrationSettings = typeof IntegrationSettings.Type;

export const defaultIntegrationSettings: IntegrationSettings = {
  t3Code: { enabled: true, projectAppearance: true, discoverProjects: true },
};
