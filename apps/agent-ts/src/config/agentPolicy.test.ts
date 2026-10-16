import { describe, expect, it } from "@effect/vitest";

import { decidePolicy } from "./agentPolicy.ts";

describe("decidePolicy", () => {
  it("keeps denials from files written before the denied list", () => {
    expect(decidePolicy({ allowedTiers: ["git"] })).toStrictEqual({
      policy: { allowedTiers: ["git", "update", "t3code"] },
      defaulted: ["update", "t3code"],
      incomplete: true,
    });
  });

  it("follows a complete file", () => {
    expect(
      decidePolicy({ allowedTiers: ["git"], deniedTiers: ["cleanup", "update", "t3code"] }),
    ).toStrictEqual({
      policy: { allowedTiers: ["git"] },
      defaulted: [],
      incomplete: false,
    });
  });

  it("gives undecided tiers their defaults", () => {
    expect(decidePolicy({ allowedTiers: [], deniedTiers: ["git"] })).toStrictEqual({
      policy: { allowedTiers: ["cleanup", "update", "t3code"] },
      defaulted: ["cleanup", "update", "t3code"],
      incomplete: true,
    });
    expect(decidePolicy(null).policy.allowedTiers).toStrictEqual([
      "git",
      "cleanup",
      "update",
      "t3code",
    ]);
  });

  it("allows T3 Code updates on a machine whose policy predates them", () => {
    expect(
      decidePolicy({ allowedTiers: ["git"], deniedTiers: ["cleanup", "update"] }),
    ).toStrictEqual({
      policy: { allowedTiers: ["git", "t3code"] },
      defaulted: ["t3code"],
      incomplete: true,
    });
  });
});
