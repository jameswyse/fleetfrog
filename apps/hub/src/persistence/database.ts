import { mkdirSync } from "node:fs";
import path from "node:path";

import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { Effect, Layer, Schema } from "effect";

import { HubConfig } from "../hubConfig.ts";
import { initial } from "./migrations/0001_initial.ts";
import { actions } from "./migrations/0002_actions.ts";
import { machineUsage } from "./migrations/0003_machine_usage.ts";
import { machineKind } from "./migrations/0004_machine_kind.ts";
import { archiveFolder } from "./migrations/0005_archive_folder.ts";
import { machineArchiveFolder } from "./migrations/0006_machine_archive_folder.ts";
import { machineTrash } from "./migrations/0007_machine_trash.ts";
import { machineArchiveEvents } from "./migrations/0008_machine_archive_events.ts";
import { t3Code } from "./migrations/0009_t3code.ts";
import { users } from "./migrations/0010_users.ts";
import { activityActors } from "./migrations/0011_activity_actors.ts";
import { signInMethods } from "./migrations/0012_sign_in_methods.ts";
import { tailscaleSignIn } from "./migrations/0013_tailscale_sign_in.ts";
import { preferences } from "./migrations/0014_preferences.ts";
import { projectLayouts } from "./migrations/0015_project_layouts.ts";

const client = Layer.unwrap(
  Effect.gen(function* () {
    const { dataDirectory, demo } = yield* HubConfig;

    if (demo) {
      return SqliteClient.layer({ filename: ":memory:" });
    }

    mkdirSync(dataDirectory, { recursive: true });

    return SqliteClient.layer({ filename: path.join(dataDirectory, "fleetfrog.db") });
  }),
);

export const migrations = {
  "0001_initial": initial,
  "0002_actions": actions,
  "0003_machine_usage": machineUsage,
  "0004_machine_kind": machineKind,
  "0005_archive_folder": archiveFolder,
  "0006_machine_archive_folder": machineArchiveFolder,
  "0007_machine_trash": machineTrash,
  "0008_machine_archive_events": machineArchiveEvents,
  "0009_t3code": t3Code,
  "0010_users": users,
  "0011_activity_actors": activityActors,
  "0012_sign_in_methods": signInMethods,
  "0013_tailscale_sign_in": tailscaleSignIn,
  "0014_preferences": preferences,
  "0015_project_layouts": projectLayouts,
};

export const Migrations = SqliteMigrator.layer({ loader: SqliteMigrator.fromRecord(migrations) });

export const Database = Migrations.pipe(Layer.provideMerge(client));

export function JsonColumn<S extends Schema.Top>(schema: S) {
  return Schema.fromJsonString(Schema.toCodecJson(schema));
}
