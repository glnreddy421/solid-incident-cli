import { describe, expect, it } from "vitest";
import { analyzeLocally } from "../../src/engine/analysisEngine.js";
import {
  applyHeuristicReport,
  buildHeuristicInterviewStory,
  buildHeuristicRcaReport,
} from "../../src/reports/heuristicStructuredReports.js";
import { toRawLines } from "../fixtures/helpers.js";

describe("heuristicStructuredReports", () => {
  const result = analyzeLocally({
    rawLines: toRawLines([
      "2024-03-08T14:02:12Z api error: connection refused",
      "2024-03-08T14:02:13Z api warn: retry 1/3",
      "2024-03-08T14:02:14Z gateway error: 503 upstream",
    ]),
    inputSources: [{ kind: "file", name: "test.log" }],
    mode: "text",
  });

  it("buildHeuristicRcaReport is engine-only with template sections", () => {
    const md = buildHeuristicRcaReport(result);
    expect(md).toContain("# Root cause analysis");
    expect(md).toContain("**No LLM**");
    expect(md).not.toMatch(/enrichment.*Headline|Narrative \(enrichment\)/i);
    expect(md).toContain(result.assessment.verdict);
    expect(md).toContain("## Incident summary");
    expect(md).toContain("## Likely root cause");
    expect(md).toContain("## Failure propagation");
    expect(md).toContain("2024-03-08T14:02:12Z");
  });

  it("buildHeuristicInterviewStory uses STAR sections and no AI framing", () => {
    const md = buildHeuristicInterviewStory(result);
    expect(md).toContain("# STAR narrative");
    expect(md).toContain("**No LLM**");
    expect(md).toContain("## Situation");
    expect(md).toContain("## Task");
    expect(md).toContain("## Action");
    expect(md).toContain("## Result");
  });

  it("applyHeuristicReport stores on result.heuristicReports", () => {
    const r = structuredClone(result) as typeof result;
    const snap = applyHeuristicReport(r, "rca");
    expect(snap.kind).toBe("rca");
    expect(r.heuristicReports?.rca?.markdown).toContain("# Root cause analysis");
    applyHeuristicReport(r, "interview");
    expect(r.heuristicReports?.interview?.markdown).toContain("STAR");
  });
});
