import { describe, expect, it } from "vitest";

import { progressFraction } from "./runProgress.ts";

describe("progressFraction", () => {
  it("places each phase in its share of the bar", () => {
    expect(
      progressFraction("Receiving objects:  87% (11694/13441), 44.39 MiB | 21.74 MiB/s"),
    ).toBeCloseTo(0.696);
    expect(progressFraction("Resolving deltas:  40% (400/1000)")).toBeCloseTo(0.86);
    expect(progressFraction("Updating files: 100% (2210/2210), done.")).toBeCloseTo(1);
  });

  it("only moves forward from one phase to the next", () => {
    const received = progressFraction("Receiving objects: 100% (13441/13441), done.");
    const resolving = progressFraction("Resolving deltas:   0% (0/9000)");

    expect(resolving).toBeGreaterThanOrEqual(received ?? 1);
  });

  it("has no fraction before Git reports a phase it can measure", () => {
    expect(progressFraction(null)).toBeNull();
    expect(progressFraction("remote: Counting objects:  45% (500/1100)")).toBeNull();
    expect(progressFraction("Cloning into 'fleetfrog'...")).toBeNull();
  });
});
