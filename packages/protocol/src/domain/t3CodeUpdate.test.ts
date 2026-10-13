import { describe, expect, it } from "@effect/vitest";
import { DateTime } from "effect";

import { Connection } from "./fleet.ts";
import { supportedT3CodeSchema } from "./t3Code.ts";
import {
  availableT3CodeVersion,
  canUpdateT3Code,
  isNewerT3Code,
  t3CodeChannel,
} from "./t3CodeUpdate.ts";

import type { AgentCapabilities } from "./action.ts";
import type { T3CodeStatus, T3CodeThreadState } from "./t3Code.ts";
import type { T3CodeReleases, T3CodeUpdate } from "./t3CodeUpdate.ts";

const since = DateTime.makeUnsafe("2026-10-13T00:00:00Z");

const releases: T3CodeReleases = {
  stable: "0.0.45",
  nightly: "0.0.46-nightly.20261012.3021",
  preview: null,
};

function status(options: {
  readonly version: string | null;
  readonly serviceManaged?: boolean;
  readonly threads?: ReadonlyArray<T3CodeThreadState>;
}): T3CodeStatus {
  return {
    database: "/home/dev/.t3/userdata/statev2.sqlite",
    reading: {
      _tag: "Read",
      schema: supportedT3CodeSchema,
      projects: [],
      threads: (options.threads ?? []).map((state, index) => ({
        id: `thread-${index}`,
        projectId: "project",
        title: "Thread",
        path: "/home/dev/Projects/shop",
        worktree: false,
        state,
        archived: false,
        updatedAt: since,
      })),
      threadCount: options.threads?.length ?? 0,
      unreadRecords: 0,
    },
    server: {
      version: options.version,
      startedAt: since,
      port: 3773,
      serviceManaged: options.serviceManaged ?? true,
    },
    providers: [],
  };
}

function machine(
  t3Code: T3CodeStatus,
  options: {
    readonly capabilities?: Partial<AgentCapabilities>;
    readonly t3CodeUpdate?: T3CodeUpdate;
  } = {},
) {
  return {
    connection: Connection.cases.Online.make({
      since,
      capabilities: {
        actions: [],
        allowedTiers: ["t3code"],
        policyReadable: true,
        createsFolders: true,
        updatesItself: true,
        updatesT3Code: true,
        updatesT3CodeApp: true,
        ...options.capabilities,
      },
    }),
    t3Code,
    t3CodeUpdate: options.t3CodeUpdate ?? null,
  };
}

describe("isNewerT3Code", () => {
  it("orders nightly builds by date and build number rather than as text", () => {
    expect(isNewerT3Code("0.0.46-nightly.20261012.3021", "0.0.46-nightly.20261011.2980")).toBe(
      true,
    );
    expect(isNewerT3Code("0.0.46-nightly.20261012.10000", "0.0.46-nightly.20261012.999")).toBe(
      true,
    );
    expect(isNewerT3Code("0.0.46-nightly.20261011.2980", "0.0.46-nightly.20261012.3021")).toBe(
      false,
    );
    expect(isNewerT3Code("0.0.46-nightly.20261012.3021", "0.0.46-nightly.20261012.3021")).toBe(
      false,
    );
  });

  it("ranks a release above its prereleases and compares the version numbers first", () => {
    expect(isNewerT3Code("0.0.46", "0.0.46-nightly.20261012.3021")).toBe(true);
    expect(isNewerT3Code("0.0.46-nightly.20261001.2500", "0.0.45")).toBe(true);
    expect(isNewerT3Code("0.0.45", "0.0.46-nightly.20261001.2500")).toBe(false);
    expect(isNewerT3Code("0.10.0", "0.9.9")).toBe(true);
  });

  it("never offers a version it can't read", () => {
    expect(isNewerT3Code("latest", "0.0.45")).toBe(false);
    expect(isNewerT3Code("0.0.46", "unknown")).toBe(false);
  });
});

describe("t3CodeChannel", () => {
  it("follows the release train named in the version", () => {
    expect(t3CodeChannel("0.0.46-nightly.20261012.3021")).toBe("nightly");
    expect(t3CodeChannel("0.0.46-preview.20261012.4")).toBe("preview");
    expect(t3CodeChannel("0.0.45")).toBe("stable");
  });
});

describe("availableT3CodeVersion", () => {
  it("offers the newest release on the channel the machine runs", () => {
    expect(
      availableT3CodeVersion(status({ version: "0.0.46-nightly.20261007.2787" }), releases),
    ).toBe("0.0.46-nightly.20261012.3021");
    expect(availableT3CodeVersion(status({ version: "0.0.44" }), releases)).toBe("0.0.45");
  });

  it("offers nothing when the machine is current or the version or channel is unknown", () => {
    expect(
      availableT3CodeVersion(status({ version: "0.0.46-nightly.20261012.3021" }), releases),
    ).toBeNull();
    expect(availableT3CodeVersion(status({ version: null }), releases)).toBeNull();
    expect(
      availableT3CodeVersion(status({ version: "0.0.46-preview.20261001.1" }), releases),
    ).toBeNull();
    expect(availableT3CodeVersion(null, releases)).toBeNull();
  });
});

describe("canUpdateT3Code", () => {
  const outdated = { version: "0.0.46-nightly.20261007.2787" };

  it("needs an outdated T3 Code on an online agent that can update it and allows it", () => {
    expect(canUpdateT3Code(machine(status(outdated)), releases)).toBe(true);
    expect(
      canUpdateT3Code(machine(status({ version: "0.0.46-nightly.20261012.3021" })), releases),
    ).toBe(false);
    expect(canUpdateT3Code(machine(status({ ...outdated, serviceManaged: false })), releases)).toBe(
      true,
    );
    expect(
      canUpdateT3Code(
        machine(status({ ...outdated, serviceManaged: false }), {
          capabilities: { updatesT3CodeApp: false },
        }),
        releases,
      ),
    ).toBe(false);
    expect(
      canUpdateT3Code(
        machine(status(outdated), { capabilities: { allowedTiers: ["git"] } }),
        releases,
      ),
    ).toBe(false);
    expect(
      canUpdateT3Code(
        machine(status(outdated), { capabilities: { updatesT3Code: false } }),
        releases,
      ),
    ).toBe(false);
  });

  it("waits while T3 Code is updating or running a thread", () => {
    expect(
      canUpdateT3Code(
        machine(status(outdated), {
          t3CodeUpdate: { _tag: "Updating", version: "0.0.46-nightly.20261012.3021", since },
        }),
        releases,
      ),
    ).toBe(false);
    expect(
      canUpdateT3Code(machine(status({ ...outdated, threads: ["Idle", "Working"] })), releases),
    ).toBe(false);
    expect(
      canUpdateT3Code(machine(status({ ...outdated, threads: ["Idle", "Waiting"] })), releases),
    ).toBe(true);
  });

  it("refuses when it can't read T3 Code's threads", () => {
    expect(
      canUpdateT3Code(
        machine({
          ...status(outdated),
          reading: { _tag: "Unreadable", message: "Missing column", schema: null },
        }),
        releases,
      ),
    ).toBe(false);

    const read = status(outdated);

    expect(
      canUpdateT3Code(
        machine({
          ...read,
          reading:
            read.reading._tag === "Read" ? { ...read.reading, unreadRecords: 1 } : read.reading,
        }),
        releases,
      ),
    ).toBe(false);
  });
});
