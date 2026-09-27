import { DateTime } from "effect";
import { describe, expect, it } from "vitest";

import { MachineId } from "@fleetfrog/protocol/domain/machine";
import { defaultPollingSettings } from "@fleetfrog/protocol/domain/polling";
import {
  defaultIntegrationSettings,
  supportedT3CodeSchema,
} from "@fleetfrog/protocol/domain/t3Code";

import { t3CodeIssues } from "./t3CodeHealth.ts";

import type { Fleet, Machine } from "@fleetfrog/protocol/domain/fleet";
import type { T3CodeReading } from "@fleetfrog/protocol/domain/t3Code";

const at = DateTime.makeUnsafe("2026-09-27T00:00:00Z");

function machine(id: string, reading: T3CodeReading | null): Machine {
  return {
    id: MachineId.make(id),
    info: {
      hostname: id.slice(0, 4),
      prettyName: null,
      platform: "darwin",
      homeDirectory: "/Users/dev",
      agentVersion: "0.0.0",
      githubCli: { _tag: "Unavailable", reason: "" },
      system: null,
    },
    customName: null,
    customKind: null,
    connection: { _tag: "Offline", lastSeenAt: null },
    discoveryRoots: [],
    archiveFolder: null,
    archiveFolderStatus: null,
    lastDiscoveryAt: null,
    lastStatusAt: null,
    pairedAt: at,
    usage: null,
    trash: [],
    t3Code: reading === null ? null : { database: "/Users/dev/.t3/userdata/state.sqlite", reading },
  };
}

const read = (migration: number, unreadRecords = 0): T3CodeReading => ({
  _tag: "Read",
  schema: { migration, name: "Some migration" },
  projects: [],
  threads: [],
  threadCount: 0,
  unreadRecords,
});

describe("t3CodeIssues", () => {
  it("flags unreadable databases and schemas either side of the supported one", () => {
    const fleet: Fleet = {
      machines: [
        machine("aaaaaaaa-0000-4000-8000-000000000000", read(supportedT3CodeSchema.migration)),
        machine("bbbbbbbb-0000-4000-8000-000000000000", read(supportedT3CodeSchema.migration + 1)),
        machine("cccccccc-0000-4000-8000-000000000000", read(supportedT3CodeSchema.migration - 1)),
        machine("dddddddd-0000-4000-8000-000000000000", {
          _tag: "Unreadable",
          message: "T3 Code's database has no projection_threads.worktree_path.",
          schema: null,
        }),
        machine("eeeeeeee-0000-4000-8000-000000000000", { _tag: "NotFound" }),
        machine("ffffffff-0000-4000-8000-000000000000", null),
        machine("99999999-0000-4000-8000-000000000000", read(supportedT3CodeSchema.migration, 2)),
      ],
      repositories: [],
      archive: [],
      polling: defaultPollingSettings,
      integrations: defaultIntegrationSettings,
    };

    expect(
      t3CodeIssues(fleet).map((issue) => [
        issue.machine.info.hostname,
        issue._tag === "Drift" ? issue.direction : issue._tag,
      ]),
    ).toEqual([
      ["bbbb", "Newer"],
      ["cccc", "Older"],
      ["dddd", "Unreadable"],
      ["9999", "UnreadRecords"],
    ]);
  });
});
