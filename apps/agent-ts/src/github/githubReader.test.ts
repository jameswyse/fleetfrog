import { describe, expect, it } from "@effect/vitest";
import { Duration } from "effect";

import { retryDelay } from "./githubReader.ts";

describe("retryDelay", () => {
  it("retries less often after each failure, up to the interval", () => {
    const interval = Duration.seconds(900);
    const delays = [1, 2, 3, 4, 5, 6].map((failures) =>
      Duration.toSeconds(retryDelay(failures, interval)),
    );

    expect(delays).toEqual([60, 120, 240, 480, 900, 900]);
    expect(Duration.toSeconds(retryDelay(40, interval))).toBe(900);
    expect(Duration.toSeconds(retryDelay(1, Duration.zero))).toBe(0);
  });
});
