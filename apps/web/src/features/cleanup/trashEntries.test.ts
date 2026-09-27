import { DateTime } from "effect";
import { describe, expect, it } from "vitest";

import { MachineId } from "@fleetfrog/protocol/domain/machine";
import { defaultPollingSettings } from "@fleetfrog/protocol/domain/polling";
import { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";
import { defaultIntegrationSettings } from "@fleetfrog/protocol/domain/t3Code";

import { trashEntries } from "./trashEntries.ts";

import type { GitStatus } from "@fleetfrog/protocol/domain/checkout";
import type { Fleet, Machine } from "@fleetfrog/protocol/domain/fleet";

const at = (iso: string) => DateTime.makeUnsafe(iso);
const none = { items: [], total: 0 };

const machine: Machine = {
  id: MachineId.make("aaaaaaaa-0000-4000-8000-000000000000"),
  info: {
    hostname: "studio",
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
  pairedAt: at("2026-09-01T00:00:00Z"),
  usage: null,
  trash: [],
  t3Code: null,
};

const git: GitStatus = {
  head: { _tag: "Branch", name: "main", upstream: null },
  operation: null,
  lastCommit: null,
  changed: none,
  untracked: none,
  stashes: none,
  branches: none,
  defaultBranch: null,
  deletedBranches: {
    items: [
      {
        name: "old",
        ref: "refs/fleetfrog/deleted/1/old",
        sha: "a",
        subject: "Old work",
        deletedAt: at("2026-09-02T00:00:00Z"),
      },
    ],
    total: 1,
  },
  droppedStashes: {
    items: [
      {
        ref: "refs/fleetfrog/stashes/2/0",
        sha: "b",
        message: "On main: idea",
        droppedAt: at("2026-09-03T00:00:00Z"),
      },
    ],
    total: 1,
  },
  worktrees: [],
  lastFetchedAt: null,
};

const fleet: Fleet = {
  machines: [machine],
  repositories: [
    {
      key: RepositoryKey.make("remote:github.com/acme/shop"),
      identity: { _tag: "Remote", host: "github.com", path: "acme/shop" },
      name: "shop",
      label: "shop",
      icon: null,
      checkouts: [
        {
          machineId: machine.id,
          checkout: {
            path: "/Users/dev/Projects/shop",
            identity: { _tag: "Remote", host: "github.com", path: "acme/shop" },
            originUrl: null,
            directoryName: "shop",
            worktree: { _tag: "Main" },
            placement: { _tag: "Projects" },
            status: { _tag: "Read", git },
            github: null,
            scannedAt: at("2026-09-04T00:00:00Z"),
          },
        },
      ],
    },
  ],
  archive: [],
  polling: defaultPollingSettings,
  integrations: defaultIntegrationSettings,
};

describe("trashEntries", () => {
  it("lists deleted branches and dropped stashes, most recently deleted first", () => {
    expect(trashEntries(fleet).map(({ target }) => target)).toEqual([
      { _tag: "Stash", path: "/Users/dev/Projects/shop", ref: "refs/fleetfrog/stashes/2/0" },
      { _tag: "Branch", path: "/Users/dev/Projects/shop", ref: "refs/fleetfrog/deleted/1/old" },
    ]);
  });
});
