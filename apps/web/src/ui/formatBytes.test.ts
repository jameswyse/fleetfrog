import { describe, expect, it } from "vitest";

import { formatBytes } from "./formatBytes.ts";

describe("formatBytes", () => {
  it("uses decimal units with a decimal place only for small values", () => {
    expect(formatBytes(850)).toBe("850 bytes");
    expect(formatBytes(4_200_000)).toBe("4.2 MB");
    expect(formatBytes(312_000_000)).toBe("312 MB");
    expect(formatBytes(150_000_000_000_000)).toBe("150 TB");
  });
});
