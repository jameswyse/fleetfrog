import { describe, expect, it } from "@effect/vitest";
import { DateTime } from "effect";

import { MachineId } from "@fleetfrog/protocol/domain/machine";
import { defaultPollingSettings } from "@fleetfrog/protocol/domain/polling";
import { defaultIntegrationSettings } from "@fleetfrog/protocol/domain/t3Code";

import { buildFleet } from "./buildFleet.ts";

import type { Checkout } from "@fleetfrog/protocol/domain/checkout";
import type { RepositoryIdentity } from "@fleetfrog/protocol/domain/repositoryIdentity";
import type { IntegrationSettings, T3CodeProject } from "@fleetfrog/protocol/domain/t3Code";

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
    customKind: null,
    discoveryRoots: ["~/Projects", "~/Code"],
    rootStatuses: [{ path: "~/Projects", status: "Folder" }],
    usage: null,
    archiveFolder: null,
    trash: [],
    t3Code: null,
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
    placement: { _tag: "Projects" },
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
            capabilities: {
              actions: ["Fetch"],
              allowedTiers: ["git"],
              policyReadable: true,
              createsFolders: true,
            },
          },
        ],
      ]),
      polling: defaultPollingSettings,
      integrations: defaultIntegrationSettings,
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
      integrations: defaultIntegrationSettings,
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
      integrations: defaultIntegrationSettings,
    });

    expect(fleet.repositories.map(({ name }) => name)).toEqual(["API", "notes"]);
  });

  it("labels a repository with its owner only when another shares its name", () => {
    const remote = (host: string, path: string): RepositoryIdentity => ({
      _tag: "Remote",
      host,
      path,
    });
    const fleet = buildFleet({
      machines: [machine(laptop, "laptop")],
      checkouts: [
        {
          machineId: laptop,
          checkout: checkout("/home/dev/a", remote("github.com", "jameswyse/dhf")),
        },
        {
          machineId: laptop,
          checkout: checkout("/home/dev/b", remote("github.com", "airteamaus/DHF")),
        },
        {
          machineId: laptop,
          checkout: checkout("/home/dev/c", remote("dev.azure.com", "acme/web/_git/dhf")),
        },
        {
          machineId: laptop,
          checkout: checkout("/home/dev/dhf", { _tag: "RootCommit", sha: "abc1234ff" }),
        },
        {
          machineId: laptop,
          checkout: checkout("/home/dev/shop", remote("github.com", "acme/shop")),
        },
      ],
      online: new Map(),
      polling: defaultPollingSettings,
      integrations: defaultIntegrationSettings,
    });

    expect(fleet.repositories.map(({ name, label }) => [name, label])).toEqual([
      ["dhf", "acme/web/dhf"],
      ["DHF", "airteamaus/DHF"],
      ["dhf", "dhf (abc1234)"],
      ["dhf", "jameswyse/dhf"],
      ["shop", "shop"],
    ]);
  });

  describe("with T3 Code", () => {
    const shop: RepositoryIdentity = { _tag: "Remote", host: "github.com", path: "acme/shop" };
    const site: RepositoryIdentity = { _tag: "Remote", host: "github.com", path: "acme/site" };
    const blog: RepositoryIdentity = { _tag: "Remote", host: "github.com", path: "acme/blog" };

    const project = (options: {
      readonly title: string;
      readonly path: string;
      readonly updatedAt: string;
      readonly icon?: T3CodeProject["icon"];
    }): T3CodeProject => ({
      id: options.title,
      title: options.title,
      path: options.path,
      icon: options.icon ?? null,
      autoPull: false,
      updatedAt: DateTime.makeUnsafe(options.updatedAt),
    });

    const withProjects = (
      id: MachineId,
      hostname: string,
      projects: ReadonlyArray<T3CodeProject>,
    ): MachineRecord => ({
      ...machine(id, hostname),
      t3Code: {
        database: "/home/dev/.t3/userdata/state.sqlite",
        reading: {
          _tag: "Read",
          schema: { migration: 54, name: "ProjectionThreadsAutoSettleDisabledAt" },
          projects,
          threads: [],
          threadCount: 0,
          unreadRecords: 0,
        },
        server: null,
        providers: [],
      },
    });

    const build = (integrations: IntegrationSettings) =>
      buildFleet({
        machines: [
          withProjects(laptop, "laptop", [
            project({
              title: "Storefront",
              path: "/home/dev/shop",
              updatedAt: "2026-09-03T00:00:00Z",
              icon: { _tag: "Lucide", name: "store", color: "amber" },
            }),
            project({ title: "Blog", path: "/home/dev/site", updatedAt: "2026-09-01T00:00:00Z" }),
          ]),
          withProjects(desktop, "desktop", [
            project({
              title: "Shop",
              path: "/home/dev/code/shop",
              updatedAt: "2026-09-02T00:00:00Z",
            }),
          ]),
        ],
        checkouts: [
          { machineId: laptop, checkout: checkout("/home/dev/shop", shop) },
          { machineId: desktop, checkout: checkout("/home/dev/code/shop", shop) },
          { machineId: laptop, checkout: checkout("/home/dev/site", site) },
          { machineId: laptop, checkout: checkout("/home/dev/blog", blog) },
        ],
        online: new Map(),
        polling: defaultPollingSettings,
        integrations,
      });

    it("names each repository after its most recently changed project, keeping names apart", () => {
      const fleet = build(defaultIntegrationSettings);

      expect(fleet.repositories.map(({ label, icon }) => [label, icon])).toEqual([
        ["blog", null],
        ["Blog (site)", null],
        ["Storefront", { _tag: "Lucide", name: "store", color: "amber" }],
      ]);
    });

    it("leaves names, icons and machines' readings alone while it's off", () => {
      const fleet = build({
        t3Code: { enabled: false, projectAppearance: true, discoverProjects: true },
      });

      expect(fleet.repositories.map(({ label }) => label)).toEqual(["blog", "shop", "site"]);
      expect(fleet.machines.map(({ t3Code }) => t3Code)).toEqual([null, null]);
    });

    it("keeps repository names while project names and icons are turned off", () => {
      const fleet = build({
        t3Code: { enabled: true, projectAppearance: false, discoverProjects: true },
      });

      expect(fleet.repositories.map(({ label }) => label)).toEqual(["blog", "shop", "site"]);
      expect(fleet.machines.every(({ t3Code }) => t3Code !== null)).toBe(true);
    });
  });
});
