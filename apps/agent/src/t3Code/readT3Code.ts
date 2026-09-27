import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { DateTime, Effect, Option, Schema } from "effect";

import { isWithin } from "@fleetfrog/protocol/domain/cloneDestination";
import {
  ProjectIcon,
  ProjectIconColor,
  T3CodeReading,
  T3CodeSchema,
} from "@fleetfrog/protocol/domain/t3Code";

import { readT3CodeProviders, readT3CodeServer } from "./readT3CodeApp.ts";

import type { ProjectIconFile } from "@fleetfrog/protocol/agent/rpcs";
import type {
  T3CodeProject,
  T3CodeStatus,
  T3CodeThread,
  T3CodeThreadState,
} from "@fleetfrog/protocol/domain/t3Code";

/** Where T3 Code keeps its database, following its `T3CODE_HOME` setting. */
export function t3CodeDatabasePath(): string {
  return path.join(
    process.env.T3CODE_HOME ?? path.join(homedir(), ".t3"),
    "userdata",
    "state.sqlite",
  );
}

/** Every column read below, checked first so a changed schema is named rather than misread. */
const requiredColumns = {
  effect_sql_migrations: ["migration_id", "name"],
  projection_projects: [
    "project_id",
    "title",
    "workspace_root",
    "project_icon_json",
    "favicon_path",
    "auto_pull",
    "updated_at",
    "deleted_at",
  ],
  projection_threads: [
    "thread_id",
    "project_id",
    "title",
    "worktree_path",
    "archived_at",
    "deleted_at",
    "updated_at",
    "pending_approval_count",
    "pending_user_input_count",
  ],
  projection_thread_sessions: ["thread_id", "status", "active_turn_id"],
} as const;

const MigrationRow = Schema.Struct({ migration_id: Schema.Int, name: Schema.String });

const ProjectRow = Schema.Struct({
  project_id: Schema.String,
  title: Schema.String,
  workspace_root: Schema.String,
  project_icon_json: Schema.NullOr(Schema.String),
  favicon_path: Schema.NullOr(Schema.String),
  auto_pull: Schema.Int,
  updated_at: Schema.DateTimeUtcFromString,
});
type ProjectRow = typeof ProjectRow.Type;

const ThreadRow = Schema.Struct({
  thread_id: Schema.String,
  project_id: Schema.String,
  title: Schema.String,
  worktree_path: Schema.NullOr(Schema.String),
  archived: Schema.Int,
  updated_at: Schema.DateTimeUtcFromString,
  pending_approval_count: Schema.Int,
  pending_user_input_count: Schema.Int,
  session_status: Schema.NullOr(Schema.String),
  active_turn_id: Schema.NullOr(Schema.String),
});
type ThreadRow = typeof ThreadRow.Type;

/** A row T3 Code wrote in a shape this agent doesn't expect is left out, not the whole read. */
const decodeProject = Schema.decodeUnknownOption(ProjectRow);
const decodeThread = Schema.decodeUnknownOption(ThreadRow);
const decodeMigration = Schema.decodeUnknownOption(MigrationRow);

/** T3 Code's own icon format. A Lucide icon with monogram text shows as the monogram. */
const StoredIcon = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("lucide"),
    name: Schema.String,
    color: ProjectIconColor,
    monogramText: Schema.optionalKey(Schema.String),
    monogram: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("emoji"), emoji: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("monogram"), text: Schema.String, color: ProjectIconColor }),
]);
const decodeStoredIcon = Schema.decodeUnknownOption(Schema.fromJsonString(StoredIcon));

/** The icon picked in T3 Code, null for none, or `Unreadable` for one stored in a form this can't read. */
function pickedIcon(json: string | null): ProjectIcon | "Unreadable" | null {
  if (json === null) {
    return null;
  }

  return Option.match(decodeStoredIcon(json), {
    onNone: () => "Unreadable" as const,
    onSome: (icon) => {
      if (icon.kind === "emoji") {
        return ProjectIcon.cases.Emoji.make({ emoji: icon.emoji });
      }

      if (icon.kind === "monogram") {
        return ProjectIcon.cases.Monogram.make({ text: icon.text, color: icon.color });
      }

      const text = icon.monogramText ?? icon.monogram;

      return text === undefined
        ? ProjectIcon.cases.Lucide.make({ name: icon.name, color: icon.color })
        : ProjectIcon.cases.Monogram.make({ text, color: icon.color });
    },
  });
}

function normalise(title: string): string {
  return title.normalize("NFKC").trim();
}

/**
 * T3 Code's own icon for a project with none: two characters of its name, such as `AS` for
 * "Agent Skills", in a colour picked from the name.
 */
export function defaultMonogram(title: string): ProjectIcon {
  const words = normalise(title).match(/[\p{L}\p{N}]+/gu) ?? [];
  const first = words[0];
  const characters = Array.from(first ?? "");
  const start = characters[0] ?? "P";
  const second =
    characters.slice(1).find((character) => /\p{N}/u.test(character)) ??
    (words.length > 1 ? Array.from(words.at(-1) ?? "")[0] : characters.at(-1)) ??
    start;
  const text =
    first === undefined ? "PR" : Array.from(`${start}${second}`.toUpperCase()).slice(0, 2).join("");
  const colours = ProjectIconColor.literals;
  let hash = 0;

  for (const character of normalise(title).toLocaleLowerCase("en-US") || "project") {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % colours.length;
  }

  return ProjectIcon.cases.Monogram.make({ text, color: colours[hash] ?? "blue" });
}

/** The files T3 Code tries, in its order, when a project has no icon of its own. */
const faviconCandidates = [
  "favicon.svg",
  "favicon.ico",
  "favicon.png",
  "public/favicon.svg",
  "public/favicon.ico",
  "public/favicon.png",
  "app/favicon.ico",
  "app/favicon.png",
  "app/icon.svg",
  "app/icon.png",
  "app/icon.ico",
  "src/favicon.ico",
  "src/favicon.svg",
  "src/app/favicon.ico",
  "src/app/icon.svg",
  "src/app/icon.png",
  "assets/icon.svg",
  "assets/icon.png",
  "assets/logo.svg",
  "assets/logo.png",
  ".idea/icon.svg",
];

const imageTypes = new Map([
  [".avif", "image/avif"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

/** Larger files are left out, since every dashboard downloads each icon. */
const maximumIconBytes = 256 * 1024;

/**
 * The image at `relativePath` in the project folder, or null when there's no usable one. The
 * repository decides what's there, so a link out of the folder, such as `favicon.svg` pointing at a
 * private key, is refused, and a file that can't be read is simply not an icon.
 */
async function readImage(folder: string, relativePath: string): Promise<ProjectIconFile | null> {
  const file = await realpath(path.resolve(folder, relativePath)).catch(() => null);
  const mediaType = file === null ? undefined : imageTypes.get(path.extname(file).toLowerCase());

  if (file === null || mediaType === undefined || !isWithin(file, folder)) {
    return null;
  }

  const found = await stat(file).catch(() => null);

  if (found === null || !found.isFile() || found.size === 0 || found.size > maximumIconBytes) {
    return null;
  }

  const bytes = await readFile(file).catch(() => null);

  return bytes === null
    ? null
    : {
        id: createHash("sha256").update(bytes).digest("hex"),
        mediaType,
        base64: bytes.toString("base64"),
      };
}

/** The image T3 Code shows for a project without a picked icon: the one set, or the first found. */
async function findFavicon(
  folder: string,
  faviconPath: string | null,
): Promise<ProjectIconFile | null> {
  for (const candidate of faviconPath === null ? faviconCandidates : [faviconPath]) {
    const image = await readImage(folder, candidate);

    if (image !== null) {
      return image;
    }
  }

  return null;
}

function threadState(row: ThreadRow): T3CodeThreadState {
  if (row.pending_approval_count > 0 || row.pending_user_input_count > 0) {
    return "Waiting";
  }

  return row.active_turn_id !== null ||
    row.session_status === "starting" ||
    row.session_status === "running"
    ? "Working"
    : "Idle";
}

/** How long an idle thread stays in the reading after it last changed. */
const recentThreadMillis = 14 * 24 * 60 * 60 * 1000;

class Unreadable extends Schema.TaggedError<Unreadable>()("Unreadable", {
  message: Schema.String,
  schema: Schema.NullOr(T3CodeSchema),
}) {}

/** The rows that decode, and how many didn't. */
function decodeRows<A>(rows: ReadonlyArray<unknown>, decode: (row: unknown) => Option.Option<A>) {
  const decoded = rows.flatMap((row) => Option.toArray(decode(row)));

  return { decoded, unread: rows.length - decoded.length };
}

/**
 * Reads the rows FleetFrog uses in one read transaction, closing the database straight after. T3
 * Code keeps it in WAL mode, so reading never blocks its writes, and closing at once lets it
 * checkpoint the log. The read is synchronous, so it waits only briefly for a lock.
 */
function readRows(file: string) {
  const database = new DatabaseSync(file, { readOnly: true, timeout: 500 });

  try {
    database.exec("begin");

    const [latest] = database
      .prepare("select migration_id, name from effect_sql_migrations order by migration_id desc")
      .all()
      .flatMap((row) => Option.toArray(decodeMigration(row)));
    const schema =
      latest === undefined ? null : { migration: latest.migration_id, name: latest.name };
    const missing = Object.entries(requiredColumns).flatMap(([table, columns]) => {
      const present = new Set(
        database
          .prepare("select name from pragma_table_info(?)")
          .all(table)
          .map((row) => row.name),
      );

      return columns.filter((column) => !present.has(column)).map((column) => `${table}.${column}`);
    });

    if (missing.length > 0) {
      throw new Unreadable({ message: `T3 Code's database has no ${missing.join(", ")}.`, schema });
    }

    if (schema === null) {
      throw new Unreadable({ message: "T3 Code's database records no migrations.", schema: null });
    }

    const projects = decodeRows(
      database
        .prepare(
          `select project_id, title, workspace_root, project_icon_json, favicon_path, auto_pull,
            updated_at
          from projection_projects where deleted_at is null`,
        )
        .all(),
      decodeProject,
    );
    const threads = decodeRows(
      database
        .prepare(
          `select thread.thread_id, thread.project_id, thread.title, thread.worktree_path,
            thread.archived_at is not null as archived, thread.updated_at,
            thread.pending_approval_count, thread.pending_user_input_count,
            session.status as session_status, session.active_turn_id
          from projection_threads as thread
          left join projection_thread_sessions as session on session.thread_id = thread.thread_id
          where thread.deleted_at is null`,
        )
        .all(),
      decodeThread,
    );

    database.exec("commit");

    return { schema, projects, threads };
  } finally {
    database.close();
  }
}

/** The path with symbolic links resolved, as Git reports checkouts, or unchanged if it's missing. */
const resolvePath = (file: string) => realpath(file).catch(() => file);

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * What T3 Code has on this machine: its projects and their threads, and with `projectIcons`, the
 * image files its projects show as icons. `favicons` remembers each project's image between reads,
 * so emptying it looks for them again.
 */
export const readT3Code = Effect.fn("readT3Code")(function* (options: {
  readonly database: string;
  readonly projectIcons: boolean;
  readonly favicons: Map<string, ProjectIconFile | null>;
}) {
  // The database sits in T3 Code's `userdata` folder, beside its runtime file and below its home.
  const userdata = path.dirname(options.database);
  const server = yield* readT3CodeServer(userdata);
  const providers = yield* readT3CodeProviders(path.join(path.dirname(userdata), "caches"));
  const status = (reading: T3CodeReading): T3CodeStatus => ({
    database: options.database,
    reading,
    server,
    providers,
  });
  const exists = yield* Effect.promise(() =>
    stat(options.database).then(
      (found) => found.isFile(),
      () => false,
    ),
  );

  if (!exists) {
    return { status: status(T3CodeReading.cases.NotFound.make({})), icons: [] };
  }

  const rows = yield* Effect.try({
    try: () => readRows(options.database),
    catch: (error) =>
      error instanceof Unreadable
        ? error
        : new Unreadable({
            message: `Couldn't read T3 Code's database: ${describe(error)}`,
            schema: null,
          }),
  }).pipe(Effect.result);

  if (rows._tag === "Failure") {
    return {
      status: status(
        T3CodeReading.cases.Unreadable.make({
          message: rows.failure.message,
          schema: rows.failure.schema,
        }),
      ),
      icons: [],
    };
  }

  const icons = new Map<string, ProjectIconFile>();
  let unreadIcons = 0;

  const favicon = async (folder: string, faviconPath: string | null) => {
    const key = `${folder}\0${faviconPath ?? ""}`;
    const known = options.favicons.get(key);

    if (known !== undefined) {
      return known;
    }

    const found = await findFavicon(folder, faviconPath);

    options.favicons.set(key, found);

    return found;
  };

  const projects = yield* Effect.promise(() =>
    Promise.all(
      rows.success.projects.decoded.map(async (row: ProjectRow): Promise<T3CodeProject> => {
        const folder = await resolvePath(row.workspace_root);
        const picked = pickedIcon(row.project_icon_json);

        if (picked === "Unreadable") {
          unreadIcons += 1;
        }

        // An icon that can't be read falls back to what T3 Code shows for a project without one.
        const own = picked === "Unreadable" ? null : picked;
        const image =
          own === null && options.projectIcons ? await favicon(folder, row.favicon_path) : null;

        if (image !== null) {
          icons.set(image.id, image);
        }

        return {
          id: row.project_id,
          title: row.title,
          path: folder,
          icon:
            image === null
              ? (own ?? defaultMonogram(row.title))
              : ProjectIcon.cases.Image.make({ id: image.id }),
          autoPull: row.auto_pull !== 0,
          updatedAt: row.updated_at,
        };
      }),
    ),
  );
  const folders = new Map(projects.map((project) => [project.id, project.path]));
  const recentSince = DateTime.toEpochMillis(yield* DateTime.now) - recentThreadMillis;
  // A thread of a deleted project has nowhere to work, so it's left out.
  const current = rows.success.threads.decoded.filter(({ project_id }) => folders.has(project_id));
  const threads = yield* Effect.promise(() =>
    Promise.all(
      current.map(async (row): Promise<T3CodeThread> => ({
        id: row.thread_id,
        projectId: row.project_id,
        title: row.title,
        path:
          row.worktree_path === null
            ? (folders.get(row.project_id) ?? "")
            : await resolvePath(row.worktree_path),
        worktree: row.worktree_path !== null,
        state: threadState(row),
        archived: row.archived !== 0,
        updatedAt: row.updated_at,
      })),
    ),
  );

  return {
    status: status(
      T3CodeReading.cases.Read.make({
        schema: rows.success.schema,
        projects,
        threads: threads
          .filter(
            (thread) =>
              thread.worktree ||
              (!thread.archived &&
                (thread.state !== "Idle" ||
                  DateTime.toEpochMillis(thread.updatedAt) >= recentSince)),
          )
          .toSorted(
            (left, right) =>
              DateTime.toEpochMillis(right.updatedAt) - DateTime.toEpochMillis(left.updatedAt),
          ),
        threadCount: threads.filter(({ archived }) => !archived).length,
        unreadRecords: rows.success.projects.unread + rows.success.threads.unread + unreadIcons,
      }),
    ),
    icons: [...icons.values()],
  };
});
