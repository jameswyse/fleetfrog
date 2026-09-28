import { describe, expect, it } from "@effect/vitest";

import { decidePolicy } from "./agentPolicy.ts";

describe("decidePolicy", () => {
  it("keeps denials from files written before the denied list", () => {
    expect(decidePolicy({ allowedTiers: ["git"] })).toEqual({
      policy: { allowedTiers: ["git", "update"] },
      defaulted: ["update"],
      incomplete: true,
    });
  });

  it("follows a complete file", () => {
    expect(decidePolicy({ allowedTiers: ["git"], deniedTiers: ["cleanup", "update"] })).toEqual({
      policy: { allowedTiers: ["git"] },
      defaulted: [],
      incomplete: false,
    });
  });

  it("gives undecided tiers their defaults", () => {
    expect(decidePolicy({ allowedTiers: [], deniedTiers: ["git"] })).toEqual({
      policy: { allowedTiers: ["cleanup", "update"] },
      defaulted: ["cleanup", "update"],
      incomplete: true,
    });
    expect(decidePolicy(null).policy.allowedTiers).toEqual(["git", "cleanup", "update"]);
  });
});
