import { describe, expect, it } from "@effect/vitest";
import { DateTime } from "effect";

import { checkCloneDestination, isWithin, suggestCloneDestination } from "./cloneDestination.ts";
import { MachineId } from "./machine.ts";
import { RepositoryKey } from "./repositoryIdentity.ts";

import type { Checkout } from "./checkout.ts";
import type { Machine, Repository } from "./fleet.ts";

const now = DateTime.makeUnsafe("2026-09-26T00:00:00Z");

function machine(options: {
  readonly id: string;
  readonly home: string;
  readonly roots: ReadonlyArray<string>;
}): Machine {
  return {
    id: MachineId.make(options.id),
    info: {
      hostname: options.id,
      prettyName: null,
      platform: "linux",
      homeDirectory: options.home,
      agentVersion: "0.0.0",
      githubCli: { _tag: "Unavailable", reason: "" },
      system: null,
    },
    customName: null,
    customKind: null,
    connection: { _tag: "Offline", lastSeenAt: null },
    discoveryRoots: options.roots.map((path) => ({ path, status: "Folder" })),
    lastDiscoveryAt: null,
    lastStatusAt: null,
    pairedAt: now,
    usage: null,
  };
}

function checkout(path: string, worktree: Checkout["worktree"] = { _tag: "Main" }): Checkout {
  return {
    path,
    identity: { _tag: "Remote", host: "github.com", path: "acme/shop" },
    originUrl: "git@github.com:acme/shop.git",
    directoryName: "shop",
    worktree,
    status: { _tag: "Failed", message: "" },
    github: null,
    scannedAt: now,
  };
}

const studio = machine({
  id: "11111111-1111-4111-8111-111111111111",
  home: "/Users/james",
  roots: ["~/Projects"],
});
const laptop = machine({
  id: "22222222-2222-4222-8222-222222222222",
  home: "/home/james",
  roots: ["~/Code", "~/Projects"],
});

function repositoryAt(...checkouts: ReadonlyArray<Checkout>): Repository {
  return {
    key: RepositoryKey.make("remote:github.com/acme/shop"),
    identity: { _tag: "Remote", host: "github.com", path: "acme/shop" },
    name: "shop",
    checkouts: checkouts.map((entry) => ({ machineId: studio.id, checkout: entry })),
  };
}

describe("suggestCloneDestination", () => {
  it("mirrors another machine's path relative to home when a discovery folder holds it", () => {
    const suggestion = suggestCloneDestination({
      repository: repositoryAt(checkout("/Users/james/Projects/shop")),
      target: laptop,
      machines: [studio, laptop],
      occupied: new Set(),
    });

    expect(suggestion?.destination).toBe("~/Projects/shop");
    expect(suggestion?.root.path).toBe("~/Projects");
  });

  it("falls back to the default folder when the mirrored path is outside every folder", () => {
    const suggestion = suggestCloneDestination({
      repository: repositoryAt(checkout("/Users/james/work/shop")),
      target: laptop,
      machines: [studio, laptop],
      occupied: new Set(),
    });

    expect(suggestion?.destination).toBe("~/Code/shop");
  });

  it("falls back to the default folder when something already occupies the mirrored path", () => {
    const suggestion = suggestCloneDestination({
      repository: repositoryAt(checkout("/Users/james/Projects/shop")),
      target: laptop,
      machines: [studio, laptop],
      occupied: new Set(["/home/james/Projects/shop"]),
    });

    expect(suggestion?.destination).toBe("~/Code/shop");
  });

  it("ignores linked worktrees, which are not where the repository lives", () => {
    const suggestion = suggestCloneDestination({
      repository: repositoryAt(
        checkout("/Users/james/Projects/shop-feature", {
          _tag: "Linked",
          mainPath: "/Users/james/elsewhere/shop",
        }),
      ),
      target: laptop,
      machines: [studio, laptop],
      occupied: new Set(),
    });

    expect(suggestion?.destination).toBe("~/Code/shop");
  });

  it("has no suggestion for a machine without discovery folders", () => {
    expect(
      suggestCloneDestination({
        repository: repositoryAt(checkout("/Users/james/Projects/shop")),
        target: { ...laptop, discoveryRoots: [] },
        machines: [studio, laptop],
        occupied: new Set(),
      }),
    ).toBeNull();
  });
});

describe("checkCloneDestination", () => {
  const check = (destination: string) =>
    checkCloneDestination({ destination, home: "/home/james", roots: ["~/Code", "/srv/git/"] })
      ._tag;

  it("accepts paths strictly inside a discovery folder", () => {
    expect(
      checkCloneDestination({
        destination: "~/Code/shop/",
        home: "/home/james",
        roots: ["~/Code"],
      }),
    ).toEqual({ _tag: "Valid", path: "/home/james/Code/shop", root: "~/Code" });
    expect(check("/srv/git/shop")).toBe("Valid");
  });

  it("rejects the folder itself, paths outside it and paths that only share a prefix", () => {
    expect(check("~/Code")).toBe("OutsideRoots");
    expect(check("~/Codes/shop")).toBe("OutsideRoots");
    expect(check("/tmp/shop")).toBe("OutsideRoots");
  });

  it("rejects hidden, relative and dot segments anywhere in the path", () => {
    expect(check("~/Code/.config/autostart")).toBe("Hidden");
    expect(check("~/Code/../.ssh/shop")).toBe("Hidden");
    expect(check("~/Code//shop")).toBe("Hidden");
    expect(check("Code/shop")).toBe("NotAbsolute");
  });
});

describe("isWithin", () => {
  it("covers the folder and everything below it, but not a sibling sharing its prefix", () => {
    expect(isWithin("/Users/sam/Code", "/Users/sam/Code/")).toBe(true);
    expect(isWithin("/Users/sam/Code/acme/shop", "/Users/sam/Code")).toBe(true);
    expect(isWithin("/Users/sam/CodeArchive/shop", "/Users/sam/Code")).toBe(false);
  });
});
