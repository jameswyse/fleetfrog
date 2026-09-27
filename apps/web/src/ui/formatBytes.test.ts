import { describe, expect, it } from "vitest";

import { formatBytes } from "./formatBytes.ts";

/** The number as this machine's locale writes it, so the test holds under any locale. */
const local = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);

describe("formatBytes", () => {
  it("uses decimal units with a decimal place only for small values", () => {
    expect(formatBytes(850)).toBe("850 bytes");
    expect(formatBytes(4_200_000)).toBe(`${local(4.2)} MB`);
    expect(formatBytes(312_000_000)).toBe("312 MB");
  });

  it("moves to the next unit when rounding would reach a thousand", () => {
    expect(formatBytes(999_600)).toBe("1 MB");
    expect(formatBytes(999_400)).toBe("999 KB");
  });
});
