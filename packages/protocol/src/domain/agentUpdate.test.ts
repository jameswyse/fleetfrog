import { describe, expect, it } from "@effect/vitest";

import { compareVersions } from "./agentUpdate.ts";

describe("compareVersions", () => {
  it("orders versions by each number rather than as text", () => {
    expect(compareVersions("0.1.10", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
  });
});
