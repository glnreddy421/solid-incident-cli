import { describe, expect, it } from "vitest";
import { analyzeLocally } from "../../src/engine/analysisEngine.js";
import { renderReport } from "../../src/reporting/renderReport.js";
import { toRawLines } from "../fixtures/helpers.js";

describe("renderReport", () => {
  const base = analyzeLocally({
    rawLines: toRawLines([
      "2024-03-08T14:02:12Z api error: connection refused",
      "2024-03-08T14:02:13Z api warn: retry 1/3",
      "2024-03-08T14:02:14Z gateway error: 503 upstream",
    ]),
    inputSources: [{ kind: "file", name: "t.log" }],
    mode: "text",
  });

  it("RCA final omits live banner and uses decisive trigger phrasing", () => {
    const r = structuredClone(base);
    r.metadata = { ...r.metadata, analysisContext: { runKind: "batch" } };
    const out = renderReport(r, { style: "rca", state: "final" }).finalText;
    expect(out).not.toContain("## Live incident snapshot");
    expect(out).not.toContain("Point-in-time assessment");
    expect(out).toMatch(/incident was triggered by|triggered by \*\*api\*\*/i);
  });

  it("RCA live includes banner and cautious footer", () => {
    const r = structuredClone(base);
    r.metadata = { ...r.metadata, analysisContext: { runKind: "live" } };
    const out = renderReport(r, { style: "rca" }).finalText;
    expect(out).toContain("## Live incident snapshot");
    expect(out).toMatch(/currently available event stream|may change as additional logs arrive/i);
    expect(out).toMatch(/strongest trigger signal so far|At this point, the most likely cause appears/i);
  });

  it("live + streamFinalized uses final-style state (no live banner)", () => {
    const r = structuredClone(base);
    r.metadata = { ...r.metadata, analysisContext: { runKind: "live", streamFinalized: true } };
    const rendered = renderReport(r, { style: "rca" });
    expect(rendered.state).toBe("final");
    expect(rendered.finalText).not.toContain("## Live incident snapshot");
  });

  it("timeline live uses tentative verbs in narrative", () => {
    const r = structuredClone(base);
    r.metadata = { ...r.metadata, analysisContext: { runKind: "live" } };
    const out = renderReport(r, { style: "timeline" }).finalText;
    expect(out).toMatch(/appears to show|Sequence observed in the current window/i);
  });

  it("STAR live marks result section as evolving", () => {
    const r = structuredClone(base);
    r.metadata = { ...r.metadata, analysisContext: { runKind: "live" } };
    const out = renderReport(r, { style: "star" }).finalText;
    expect(out).toMatch(/Current observed result \(may evolve/i);
  });

  it("--state override wins over metadata", () => {
    const r = structuredClone(base);
    r.metadata = { ...r.metadata, analysisContext: { runKind: "batch" } };
    const out = renderReport(r, { style: "rca", state: "live" }).finalText;
    expect(out).toContain("## Live incident snapshot");
  });
});
