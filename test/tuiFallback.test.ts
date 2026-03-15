import { describe, expect, it } from "vitest";
import { runTuiWithFallback } from "../src/cli/commands.js";
import type { AnalysisResult } from "../src/contracts/index.js";

function sampleResult(): AnalysisResult {
  return {
    mode: "tui",
    inputSources: [{ kind: "file", name: "sample.log" }],
    summary: {
      incidentSummary: "Payment API failures detected.",
      triggerEvent: "payment-service: connection refused",
      confidence: 86,
      affectedServices: ["payment-service", "redis"],
      incidentWindow: { start: "2026-03-14T10:00:00Z", end: "2026-03-14T10:10:00Z" },
    },
    timeline: [],
    flow: [],
    rawEvents: [],
    signals: [],
    ai: { available: false, rootCauseCandidates: [], followUpQuestions: [], recommendedChecks: [], reports: {} },
    schema: {
      schemaVersion: "1.0.0",
      generatedAt: "2026-03-14T10:10:00Z",
      timeline: [],
      flow: [],
      signals: [],
      summary: {
        incidentSummary: "Payment API failures detected.",
        triggerEvent: "payment-service: connection refused",
        confidence: 86,
        affectedServices: ["payment-service", "redis"],
        incidentWindow: { start: "2026-03-14T10:00:00Z", end: "2026-03-14T10:10:00Z" },
      },
    },
    diagnostics: { warnings: [], errors: [], transport: { backendReachable: false } },
    metadata: { rawLineCount: 0, createdAt: "2026-03-14T10:10:00Z" },
  };
}

describe("TUI fallback", () => {
  it("falls back to text output when TUI init fails", async () => {
    process.env.SOLID_TUI_INIT_FAIL = "1";
    const output = await runTuiWithFallback(sampleResult());
    expect(output.fellBack).toBe(true);
    expect(output.fallbackText).toContain("Falling back to plain text mode");
    delete process.env.SOLID_TUI_INIT_FAIL;
  });
});

