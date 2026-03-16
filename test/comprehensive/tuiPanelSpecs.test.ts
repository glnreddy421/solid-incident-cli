import { describe, expect, it } from "vitest";
import { analyzeLocally } from "../../src/engine/analysisEngine.js";
import { PANEL_SPECS } from "../../src/tui/panelSpecs.js";
import type { TuiPanelId } from "../../src/contracts/index.js";
import { toRawLines } from "../fixtures/helpers.js";

const PANEL_IDS: TuiPanelId[] = [
  "summary",
  "timeline",
  "trace-graph",
  "mindmap",
  "signals",
  "evidence",
  "ai-analysis",
  "reports",
  "diagnostics",
];

describe("TUI panel specs", () => {
  const result = analyzeLocally({
    rawLines: toRawLines([
      "2024-03-08T14:02:12Z api error: connection refused",
      "2024-03-08T14:02:13Z api warn: retry 1/3",
      "2024-03-08T14:02:14Z gateway error: 503 upstream",
    ]),
    inputSources: [{ kind: "file", name: "test.log" }],
    mode: "text",
  });

  for (const panelId of PANEL_IDS) {
    it(`${panelId} main renders without crashing`, () => {
      const spec = PANEL_SPECS[panelId];
      expect(spec).toBeDefined();
      const lines = spec.main(result, "", "");
      expect(Array.isArray(lines)).toBe(true);
      expect(lines.length).toBeGreaterThan(0);
    });

    it(`${panelId} side renders without crashing`, () => {
      const spec = PANEL_SPECS[panelId];
      expect(spec).toBeDefined();
      const lines = spec.side(result, "", "");
      expect(Array.isArray(lines)).toBe(true);
      expect(lines.length).toBeGreaterThan(0);
    });
  }

  it("summary panel contains verdict and severity", () => {
    const lines = PANEL_SPECS.summary.main(result, "", "");
    const text = lines.join("\n");
    expect(text).toContain("Incident Verdict");
    expect(text).toContain(result.assessment.verdict);
    expect(text).toContain("Severity");
  });

  it("timeline panel contains chronological events", () => {
    const lines = PANEL_SPECS.timeline.main(result, "", "");
    expect(lines.some((l) => l.includes("Raw chronological") || l.includes("api") || l.includes("gateway"))).toBe(true);
  });

  it("diagnostics panel contains score breakdown when available", () => {
    const lines = PANEL_SPECS.diagnostics.main(result, "", "");
    expect(lines.length).toBeGreaterThan(0);
  });
});
