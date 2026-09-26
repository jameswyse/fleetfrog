import { describe, expect, it } from "vitest";

import { formatDuration } from "./formatDuration.ts";

const unit = (name: string, value: number) =>
  new Intl.NumberFormat(undefined, { style: "unit", unit: name, unitDisplay: "short" }).format(
    value,
  );

describe("formatDuration", () => {
  it("shows the largest unit and the next one down, leaving out an empty remainder", () => {
    expect(formatDuration(400)).toBe(`<${unit("second", 1)}`);
    expect(formatDuration(59_000)).toBe(unit("second", 59));
    expect(formatDuration(252_000)).toBe(`${unit("minute", 4)} ${unit("second", 12)}`);
    expect(formatDuration(3_600_000)).toBe(unit("hour", 1));
    expect(formatDuration((86_400 + 3 * 3600 + 59) * 1000)).toBe(
      `${unit("day", 1)} ${unit("hour", 3)}`,
    );
  });
});
