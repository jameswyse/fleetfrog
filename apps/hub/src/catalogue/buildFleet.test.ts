import { describe, expect, it } from "@effect/vitest";
import { DateTime } from "effect";

import { MachineId } from "@fleetfrog/protocol/domain/machine";
import { defaultPollingSettings } from "@fleetfrog/protocol/domain/polling";

import { buildFleet } from "./buildFleet.ts";

import type { Checkout } from "@fleetfrog/protocol/domain/checkout";
import type { RepositoryIdentity } from "@fleetfrog/protocol/domain/repositoryIdentity";

import type { MachineRecord } from "../machines/machineStore.ts";

const pairedAt = DateTime.makeUnsafe("2026-09-01T00:00:00Z");
const laptop = MachineId.make("5b0c7a1e-7a0e-4f3e-9d63-2f8f7a8d0a01");
const desktop = MachineId.make("5b0c7a1e-7a0e-4f3e-9d63-2f8f7a8d0a02");

function machine(id: MachineId, hostname: string): MachineRecord {
  return {
    id,
    info: {
      hostname,
      prettyName: null,
      platform: "linux",
      homeDirectory: "/home/dev",
      agentVersion: "0.0.0",
      githubCli: { _tag: "Unavailable", reason: "not installed" },
      system: null,
    },
    customName: null,
    discoveryRoots: ["~/Projects", "~/Code"],
    rootStatuses: [{ path: "~/Projects", status: "Folder" }],
    usage: null,
    pairedAt,
    lastSeenAt: null,
    lastDiscoveryAt: null,
    lastStatusAt: null,
  };
}

function checkout(path: string, identity: RepositoryIdentity): Checkout {
  return {
    path,
    identity,
    originUrl: null,
    directoryName: path.split("/").at(-1) ?? path,
    worktree: { _tag: "Main" },
    status: { _tag: "Failed", message: "not read in this test" },
    github: null,
    scannedAt: pairedAt,
  };
}

describe("buildFleet", () => {
  it("groups checkouts of the same remote across machines and paths into one repository", () => {
    const shop: RepositoryIdentity = { _tag: "Remote", host: "github.com", path: "acme/shop" };
    const fleet = buildFleet({
      machines: [machine(laptop, "laptop"), machine(desktop, "desktop")],
      checkouts: [
        { machineId: laptop, checkout: checkout("/home/dev/Projects/shop", shop) },
        { machineId: desktop, checkout: checkout("/home/dev/code/shop-api", shop) },
      ],
      online: new Map([
        [
          laptop,
          {
            since: pairedAt,
            sessionId: "session",
            capabilities: { actions: ["Fetch"], allowedTiers: ["git"], policyReadable: true },
          },
        ],
      ]),
      polling: defaultPollingSettings,
    });

    expect(fleet.repositories).toHaveLength(1);
    expect(fleet.repositories[0]?.name).toBe("shop");
    expect(fleet.repositories[0]?.checkouts.map(({ machineId }) => machineId)).toEqual([
      laptop,
      desktop,
    ]);
    expect(fleet.machines.map(({ connection }) => connection._tag)).toEqual(["Online", "Offline"]);
  });

  it("pairs each configured discovery folder with what the agent last found there", () => {
    const fleet = buildFleet({
      machines: [machine(laptop, "laptop")],
      checkouts: [],
      online: new Map(),
      polling: defaultPollingSettings,
    });

    expect(fleet.machines[0]?.discoveryRoots).toEqual([
      { path: "~/Projects", status: "Folder" },
      { path: "~/Code", status: null },
    ]);
  });

  it("names local-only repositories after their most common directory and sorts by name", () => {
    const notes: RepositoryIdentity = { _tag: "RootCommit", sha: "abc123" };
    const api: RepositoryIdentity = { _tag: "Remote", host: "gitlab.com", path: "group/sub/API" };
    const fleet = buildFleet({
      machines: [machine(laptop, "laptop"), machine(desktop, "desktop")],
      checkouts: [
        { machineId: laptop, checkout: checkout("/home/dev/notes-old", notes) },
        { machineId: desktop, checkout: checkout("/home/dev/notes", notes) },
        { machineId: laptop, checkout: checkout("/home/dev/src/notes", notes) },
        { machineId: laptop, checkout: checkout("/home/dev/api", api) },
      ],
      online: new Map(),
      polling: defaultPollingSettings,
    });

    expect(fleet.repositories.map(({ name }) => name)).toEqual(["API", "notes"]);
  });
});
