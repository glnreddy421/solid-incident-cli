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
    assessment: {
      verdict: "INCIDENT DETECTED",
      severity: "high",
      healthScore: 42,
      verdictReason: "Failure patterns and propagation signals indicate incident behavior.",
      triggerClassification: "dependency_failure",
      triggerImpact: "high",
      triggerService: "payment-service",
      triggerEvent: "connection refused",
      triggerPid: "123",
      triggerHost: "host-a",
      triggerTimestamp: "2026-03-14T10:00:00Z",
      primaryService: "payment-service",
      serviceCount: 2,
      anomalyCount: 1,
      eventDistribution: { info: 0, warn: 0, error: 1, anomaly: 1 },
      systemHealthSummary: ["Error patterns detected in analysis window."],
      strongestSignals: ["dependency_failure_chain"],
      rootCauseCandidates: [{ id: "database_connection_refused", confidence: 0.81, evidence: "connection refused matches" }],
      reconstructedTimeline: ["10:00:00 payment-service failure event"],
      propagationChain: ["payment-service -> redis (connection refused)"],
      summaryNarrative: "Parsed 2 log events across 2 services. Error propagation was detected across dependent services.",
      recommendedActions: ["Inspect root failing service and dependency chain."],
    },
    timeline: [],
    flow: [],
    traceGraph: { nodes: ["payment-service", "redis"], edges: [], triggerCandidates: [] },
    rawEvents: [],
    signals: [],
    ai: { available: false, rootCauseCandidates: [], followUpQuestions: [], recommendedChecks: [], reports: {} },
    schema: {
      schemaVersion: "1.0.0",
      generatedAt: "2026-03-14T10:10:00Z",
      timeline: [],
      flow: [],
      traceGraph: { nodes: ["payment-service", "redis"], edges: [], triggerCandidates: [] },
      assessment: {
        verdict: "INCIDENT DETECTED",
        severity: "high",
        healthScore: 42,
        verdictReason: "Failure patterns and propagation signals indicate incident behavior.",
        triggerClassification: "dependency_failure",
        triggerImpact: "high",
        triggerService: "payment-service",
        triggerEvent: "connection refused",
        triggerPid: "123",
        triggerHost: "host-a",
        triggerTimestamp: "2026-03-14T10:00:00Z",
        primaryService: "payment-service",
        serviceCount: 2,
        anomalyCount: 1,
        eventDistribution: { info: 0, warn: 0, error: 1, anomaly: 1 },
        systemHealthSummary: ["Error patterns detected in analysis window."],
        strongestSignals: ["dependency_failure_chain"],
        rootCauseCandidates: [{ id: "database_connection_refused", confidence: 0.81, evidence: "connection refused matches" }],
        reconstructedTimeline: ["10:00:00 payment-service failure event"],
        propagationChain: ["payment-service -> redis (connection refused)"],
        summaryNarrative: "Parsed 2 log events across 2 services. Error propagation was detected across dependent services.",
        recommendedActions: ["Inspect root failing service and dependency chain."],
      },
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

