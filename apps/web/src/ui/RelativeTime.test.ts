import { DateTime } from "effect";
import { describe, expect, it } from "vitest";

import { formatAge, speakAge } from "./RelativeTime.tsx";

describe("formatAge", () => {
  it("shows how long ago something happened in its largest whole unit", () => {
    const now = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-26T12:00:00Z"));
    const ago = (seconds: number) => DateTime.makeUnsafe(now - seconds * 1000);

    expect(
      [0, 59, 60, 3599, 3600, 86_399, 86_400, 5 * 86_400].map((seconds) =>
        formatAge(ago(seconds), now),
      ),
    ).toStrictEqual(["now", "now", "1m", "59m", "1h", "23h", "1d", "5d"]);
    expect(formatAge(ago(-30), now)).toBe("now");
  });

  it("reads the same age aloud as it shows", () => {
    const now = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-26T12:00:00Z"));
    const ago = (seconds: number) => DateTime.makeUnsafe(now - seconds * 1000);
    const spoken = new Intl.RelativeTimeFormat(undefined, { numeric: "always" });

    expect([90 * 60, 36 * 3600].map((seconds) => formatAge(ago(seconds), now))).toStrictEqual([
      "1h",
      "1d",
    ]);
    expect([90 * 60, 36 * 3600].map((seconds) => speakAge(ago(seconds), now))).toStrictEqual([
      spoken.format(-1, "hour"),
      spoken.format(-1, "day"),
    ]);
  });
});
