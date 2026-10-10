import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

import { SystemUsage } from "./machine.ts";

describe("SystemUsage", () => {
  it("reads disk usage reported before agents measured purgeable space", () => {
    const usage = Schema.decodeUnknownSync(Schema.toCodecJson(SystemUsage))({
      disk: { totalBytes: 1000, freeBytes: 400 },
      memoryUsedBytes: null,
      loadAverage: [0.5, 0.4, 0.3],
      sampledAt: "2026-10-10T00:00:00.000Z",
    });

    expect(usage.disk).toEqual({ totalBytes: 1000, freeBytes: 400, purgeableBytes: 0 });
  });
});
