import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect } from "effect";

import { MachineId } from "@fleetfrog/protocol/domain/machine";
import { defaultPollingSettings } from "@fleetfrog/protocol/domain/polling";
import { RepositoryKey } from "@fleetfrog/protocol/domain/repositoryIdentity";

import { planBatch } from "./planBatch.ts";

import type { ActionOutcome, AgentCapabilities } from "@fleetfrog/protocol/domain/action";
import type { Checkout } from "@fleetfrog/protocol/domain/checkout";
import type { Fleet, Machine, Repository } from "@fleetfrog/protocol/domain/fleet";

const now = DateTime.makeUnsafe("2026-09-26T00:00:00Z");
const everything: AgentCapabilities = {
  actions: ["Fetch", "Pull", "Clone"],
  allowedTiers: ["git"],
  policyReadable: true,
};

function machine(
  id: string,
  connection: { readonly capabilities: AgentCapabilities } | "offline",
): Machine {
  return {
    id: MachineId.make(id),
    info: {
      hostname: id.slice(0, 4),
      prettyName: null,
      platform: "linux",
      homeDirectory: "/home/dev",
      agentVersion: "0.0.0",
      githubCli: { _tag: "Unavailable", reason: "" },
    },
    customName: null,
    connection:
      connection === "offline"
        ? { _tag: "Offline", lastSeenAt: null }
        : { _tag: "Online", since: now, capabilities: connection.capabilities },
    discoveryRoots: [{ path: "~/Projects", status: "Folder" }],
    lastDiscoveryAt: now,
    lastStatusAt: now,
    pairedAt: now,
  };
}

const online = machine("aaaaaaaa-0000-4000-8000-000000000000", { capabilities: everything });
const offline = machine("bbbbbbbb-0000-4000-8000-000000000000", "offline");
const outdated = machine("cccccccc-0000-4000-8000-000000000000", {
  capabilities: { actions: [], allowedTiers: [], policyReadable: true },
});
const locked = machine("dddddddd-0000-4000-8000-000000000000", {
  capabilities: { actions: everything.actions, allowedTiers: [], policyReadable: true },
});

function checkout(
  path: string,
  options: { readonly linked?: boolean; readonly originUrl?: string | null } = {},
): Checkout {
  return {
    path,
    identity: { _tag: "Remote", host: "github.com", path: "acme/shop" },
    originUrl: options.originUrl === undefined ? "git@github.com:acme/shop.git" : options.originUrl,
    directoryName: "shop",
    worktree:
      options.linked === true
        ? { _tag: "Linked", mainPath: "/home/dev/Projects/shop" }
        : { _tag: "Main" },
    status: { _tag: "Failed", message: "" },
    github: null,
    scannedAt: now,
  };
}

const shopKey = RepositoryKey.make("remote:github.com/acme/shop");

function fleetWith(checkouts: Repository["checkouts"]): Fleet {
  return {
    machines: [online, offline, outdated, locked],
    repositories: [
      {
        key: shopKey,
        identity: { _tag: "Remote", host: "github.com", path: "acme/shop" },
        name: "shop",
        checkouts,
      },
    ],
    polling: defaultPollingSettings,
  };
}

const onEveryMachine = fleetWith([
  { machineId: online.id, checkout: checkout("/home/dev/Projects/shop-feature", { linked: true }) },
  { machineId: online.id, checkout: checkout("/home/dev/Projects/shop") },
  { machineId: online.id, checkout: checkout("/home/dev/scratch/shop") },
  { machineId: offline.id, checkout: checkout("/home/dev/Projects/shop") },
  { machineId: outdated.id, checkout: checkout("/home/dev/Projects/shop") },
  { machineId: locked.id, checkout: checkout("/home/dev/Projects/shop") },
]);

/** The outcome's name, or the skip reason's for a skipped run. */
function outcomeName(outcome: ActionOutcome | null): string | null {
  if (outcome === null) {
    return null;
  }

  return outcome._tag === "Skipped" ? outcome.reason._tag : outcome._tag;
}

describe("planBatch", () => {
  it.effect("fetches each clone once, from its main worktree", () =>
    Effect.gen(function* () {
      const plan = yield* planBatch({ _tag: "Fetch", scope: { _tag: "All" } }, onEveryMachine);

      expect(
        plan.runs.map(({ machine: target, request, outcome }) => ({
          machine: target.id,
          request,
          outcome: outcomeName(outcome),
        })),
      ).toEqual([
        {
          machine: online.id,
          request: { _tag: "Fetch", path: "/home/dev/Projects/shop" },
          outcome: null,
        },
        {
          machine: online.id,
          request: { _tag: "Fetch", path: "/home/dev/scratch/shop" },
          outcome: null,
        },
        {
          machine: offline.id,
          request: { _tag: "Fetch", path: "/home/dev/Projects/shop" },
          outcome: "MachineOffline",
        },
        {
          machine: outdated.id,
          request: { _tag: "Fetch", path: "/home/dev/Projects/shop" },
          outcome: "AgentOutdated",
        },
        {
          machine: locked.id,
          request: { _tag: "Fetch", path: "/home/dev/Projects/shop" },
          outcome: "NotAllowed",
        },
      ]);
    }),
  );

  it.effect("pulls every worktree separately, since each has its own branch", () =>
    Effect.gen(function* () {
      const plan = yield* planBatch(
        { _tag: "Pull", scope: { _tag: "Machine", machineId: online.id } },
        onEveryMachine,
      );

      expect(plan.runs.map(({ path }) => path)).toEqual([
        "/home/dev/Projects/shop-feature",
        "/home/dev/Projects/shop",
        "/home/dev/scratch/shop",
      ]);
      expect(plan.scope).toEqual({ _tag: "Machine", machineName: "aaaa" });
    }),
  );

  it.effect("clones from the most common origin into each chosen destination", () =>
    Effect.gen(function* () {
      const plan = yield* planBatch(
        {
          _tag: "Clone",
          repositoryKey: shopKey,
          targets: [{ machineId: offline.id, destination: "~/Code/shop" }],
        },
        fleetWith([
          {
            machineId: online.id,
            checkout: checkout("/a", { originUrl: "https://github.com/acme/shop.git" }),
          },
          {
            machineId: online.id,
            checkout: checkout("/b", { originUrl: "git@github.com:acme/shop.git" }),
          },
          {
            machineId: locked.id,
            checkout: checkout("/c", { originUrl: "git@github.com:acme/shop.git" }),
          },
        ]),
      );

      expect(plan.runs.map(({ path, request }) => ({ path, request }))).toEqual([
        {
          path: "/home/dev/Code/shop",
          request: {
            _tag: "Clone",
            url: "git@github.com:acme/shop.git",
            destination: "~/Code/shop",
          },
        },
      ]);
    }),
  );

  it.effect("refuses what it can't plan", () =>
    Effect.gen(function* () {
      const noOrigin = fleetWith([
        { machineId: online.id, checkout: checkout("/a", { originUrl: null }) },
      ]);
      const failure = (fleet: Fleet, request: Parameters<typeof planBatch>[0]) =>
        planBatch(request, fleet).pipe(
          Effect.flip,
          Effect.map(({ _tag }) => _tag),
        );

      expect(
        yield* failure(noOrigin, {
          _tag: "Clone",
          repositoryKey: shopKey,
          targets: [{ machineId: offline.id, destination: "~/Code/shop" }],
        }),
      ).toBe("NoCloneSource");
      expect(
        yield* failure(noOrigin, {
          _tag: "Pull",
          scope: { _tag: "Checkout", machineId: online.id, path: "/gone" },
        }),
      ).toBe("NothingToRun");
      expect(
        yield* failure(noOrigin, {
          _tag: "Fetch",
          scope: {
            _tag: "Repository",
            repositoryKey: RepositoryKey.make("remote:github.com/acme/other"),
          },
        }),
      ).toBe("RepositoryNotFound");
    }),
  );
});
