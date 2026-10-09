import { DateTime } from "effect";
import { describe, expect, it } from "vitest";

import { MachineId } from "@fleetfrog/protocol/domain/machine";
import { defaultPollingSettings } from "@fleetfrog/protocol/domain/polling";
import {
  defaultIntegrationSettings,
  supportedT3CodeSchema,
} from "@fleetfrog/protocol/domain/t3Code";

import { describeIssue, t3CodeIssues, t3CodeNeedsAttention } from "./t3CodeHealth.ts";

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
      agentRuntime: "node",
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
    update: null,
    trash: [],
    t3Code:
      reading === null
        ? null
        : {
            database: "/Users/dev/.t3/userdata/state.sqlite",
            reading,
            server: null,
            providers: [],
          },
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

function fleetOf(machines: ReadonlyArray<Machine>): Fleet {
  return {
    hubVersion: "0.0.0",
    machines,
    repositories: [],
    archive: [],
    polling: defaultPollingSettings,
    integrations: defaultIntegrationSettings,
  };
}

describe("t3CodeIssues", () => {
  it("flags unreadable databases and schemas either side of the supported one", () => {
    const fleet = fleetOf([
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
    ]);

    expect(
      t3CodeIssues(fleet).map((issue) => [
        issue.machines.map((each) => each.info.hostname),
        issue._tag === "Drift" ? issue.direction : issue._tag,
      ]),
    ).toEqual([
      [["bbbb"], "Newer"],
      [["cccc"], "Older"],
      [["dddd"], "Unreadable"],
      [["9999"], "UnreadRecords"],
    ]);
  });

  it("reports machines on the same schema once", () => {
    const fleet = fleetOf([
      machine("aaaaaaaa-0000-4000-8000-000000000000", read(supportedT3CodeSchema.migration + 1)),
      machine("bbbbbbbb-0000-4000-8000-000000000000", read(supportedT3CodeSchema.migration + 1)),
      machine("cccccccc-0000-4000-8000-000000000000", read(supportedT3CodeSchema.migration + 2)),
    ]);

    const issues = t3CodeIssues(fleet);

    expect(issues.map((issue) => issue.machines.map((each) => each.info.hostname))).toEqual([
      ["aaaa", "bbbb"],
      ["cccc"],
    ]);
    expect(issues.map(describeIssue)[0]).toContain("T3 Code on aaaa and bbbb ");
  });
});

describe("t3CodeNeedsAttention", () => {
  it("ignores schema drift but not records it couldn't read", () => {
    const drifted = machine(
      "aaaaaaaa-0000-4000-8000-000000000000",
      read(supportedT3CodeSchema.migration + 1),
    );

    const unread = machine(
      "bbbbbbbb-0000-4000-8000-000000000000",
      read(supportedT3CodeSchema.migration, 1),
    );

    expect(t3CodeNeedsAttention(fleetOf([drifted]))).toBe(false);
    expect(t3CodeNeedsAttention(fleetOf([drifted, unread]))).toBe(true);
  });
});
