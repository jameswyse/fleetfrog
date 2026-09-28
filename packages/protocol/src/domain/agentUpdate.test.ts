import { describe, expect, it } from "@effect/vitest";
import { DateTime } from "effect";

import { canUpdateAgent, compareVersions } from "./agentUpdate.ts";
import { Connection } from "./fleet.ts";

import type { AgentCapabilities } from "./action.ts";

describe("compareVersions", () => {
  it("orders versions by each number rather than as text", () => {
    expect(compareVersions("0.1.10", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
  });
});

describe("canUpdateAgent", () => {
  const machine = (capabilities: Partial<AgentCapabilities>) => ({
    info: { agentVersion: "0.1.0" },
    connection: Connection.cases.Online.make({
      since: DateTime.makeUnsafe("2026-09-28T00:00:00Z"),
      capabilities: {
        actions: [],
        allowedTiers: ["update"],
        policyReadable: true,
        createsFolders: true,
        updatesItself: true,
        ...capabilities,
      },
    }),
    update: null,
  });

  it("needs an older agent that can update itself and whose owner allows it", () => {
    expect(canUpdateAgent(machine({}), "0.2.0")).toBe(true);
    expect(canUpdateAgent(machine({}), "0.1.0")).toBe(false);
    expect(canUpdateAgent(machine({ allowedTiers: ["git"] }), "0.2.0")).toBe(false);
    expect(canUpdateAgent(machine({ updatesItself: false }), "0.2.0")).toBe(false);
  });
});
