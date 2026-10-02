import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

import { ScanReport } from "../agent/rpcs.ts";
import { maximumReportedItems, maximumReportedText } from "./reported.ts";

const ReportJson = Schema.toCodecJson(ScanReport);
const decodeReport = Schema.decodeUnknownSync(ReportJson);

describe("reported text and lists", () => {
  it("cuts a report's long text and long lists rather than refusing it", () => {
    const report = decodeReport({
      _tag: "Status",
      changed: [],
      removedPaths: [
        "x".repeat(maximumReportedText + 1),
        ...Array.from({ length: maximumReportedItems }, (_, index) => `/home/a/${index}`),
      ],
      completedAt: "2026-10-03T00:00:00.000Z",
    });

    expect(report._tag).toBe("Status");
    expect(report._tag === "Status" && report.removedPaths).toHaveLength(maximumReportedItems);
    expect(report._tag === "Status" && report.removedPaths[0]).toHaveLength(maximumReportedText);
  });

  it("keeps a report within the limits as it was", () => {
    const report = {
      _tag: "Status",
      changed: [],
      removedPaths: ["/home/a/shop"],
      completedAt: "2026-10-03T00:00:00.000Z",
    };

    expect(Schema.encodeSync(ReportJson)(decodeReport(report))).toEqual(report);
  });
});
