import { initial } from "./0001_initial.ts";
import { actions } from "./0002_actions.ts";
import { machineUsage } from "./0003_machine_usage.ts";
import { machineKind } from "./0004_machine_kind.ts";
import { archiveFolder } from "./0005_archive_folder.ts";
import { machineArchiveFolder } from "./0006_machine_archive_folder.ts";
import { machineTrash } from "./0007_machine_trash.ts";
import { machineArchiveEvents } from "./0008_machine_archive_events.ts";
import { t3Code } from "./0009_t3code.ts";
import { users } from "./0010_users.ts";
import { activityActors } from "./0011_activity_actors.ts";
import { signInMethods } from "./0012_sign_in_methods.ts";
import { tailscaleSignIn } from "./0013_tailscale_sign_in.ts";
import { preferences } from "./0014_preferences.ts";
import { projectLayouts } from "./0015_project_layouts.ts";
import { cleanupSettings } from "./0016_cleanup_settings.ts";

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
  "0016_cleanup_settings": cleanupSettings,
};
