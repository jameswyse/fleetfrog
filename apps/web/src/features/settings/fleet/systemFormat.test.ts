import { describe, expect, it } from "vitest";

import { shortProcessorName } from "./systemFormat.ts";

describe("shortProcessorName", () => {
  it("keeps the maker, family and model, dropping marks, clock speed and core count", () => {
    expect(shortProcessorName("AMD EPYC 7302P 16-Core Processor")).toBe("AMD EPYC 7302P");
    expect(shortProcessorName("Intel(R) Core(TM) i7-8700K CPU @ 3.70GHz")).toBe(
      "Intel Core i7-8700K",
    );
    expect(shortProcessorName("12th Gen Intel(R) Core(TM) i7-1260P")).toBe(
      "12th Gen Intel Core i7-1260P",
    );
    expect(shortProcessorName("Apple M2 Max")).toBe("Apple M2 Max");
  });
});
