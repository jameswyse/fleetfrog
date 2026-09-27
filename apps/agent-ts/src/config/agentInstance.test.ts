import { describe, expect, it } from "@effect/vitest";

import { isValidInstanceName } from "./agentInstance.ts";

describe("isValidInstanceName", () => {
  it("accepts only names safe in paths and service names", () => {
    expect(["dev", "dev-2"].map(isValidInstanceName)).toEqual([true, true]);
    expect(["", "Dev", "dev-", "dev--2", "../dev", "dev.2"].map(isValidInstanceName)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
