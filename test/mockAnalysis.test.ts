import { describe, it, expect } from "vitest";
import { runMockAnalysis } from "../src/services/mockAnalysis.js";

describe("runMockAnalysis", () => {
  it("returns empty result for empty input", () => {
    const result = runMockAnalysis([]);
    expect(result.events).toHaveLength(0);
    expect(result.signals).toHaveLength(0);
    expect(result.rawLineCount).toBe(0);
    expect(result.summary.whatHappened).toMatch(/Parsed 0|No log|0 log/);
  });

  it("detects connection refused pattern", () => {
    const raw = [
      { line: '2024-03-08T14:02:12Z {"level":"error","msg":"connection refused","service":"payment-service"}', lineNumber: 1 },
      { line: '2024-03-08T14:02:13Z {"level":"error","msg":"connection refused","service":"payment-service"}', lineNumber: 2 },
    ];
    const result = runMockAnalysis(raw);
    expect(result.signals.some((s) => s.label.toLowerCase().includes("connection") || s.label.toLowerCase().includes("refused") || s.label.toLowerCase().includes("dependency"))).toBe(true);
  });

  it("detects CrashLoop pattern", () => {
    const raw = [
      { line: "2024-03-08T14:02:15Z Back-off restarting failed container payment-service in pod payment-service-xyz", lineNumber: 1 },
    ];
    const result = runMockAnalysis(raw);
    expect(result.signals.some((s) => s.label.toLowerCase().includes("crashloop"))).toBe(true);
  });

  it("detects timeout pattern", () => {
    const raw = [
      { line: "2024-03-08T14:02:00Z timeout acquiring connection", lineNumber: 1 },
      { line: "2024-03-08T14:02:01Z deadline exceeded", lineNumber: 2 },
    ];
    const result = runMockAnalysis(raw);
    expect(result.signals.some((s) => s.label.toLowerCase().includes("timeout"))).toBe(true);
  });

  it("detects pool exhausted pattern", () => {
    const raw = [
      { line: "2024-03-08T14:02:00Z connection pool exhausted", lineNumber: 1 },
    ];
    const result = runMockAnalysis(raw);
    expect(result.signals.some((s) => s.label.toLowerCase().includes("pool"))).toBe(true);
  });

  it("produces summary with impacted services", () => {
    const raw = [
      { line: '2024-03-08T14:02:12Z {"level":"error","msg":"connection refused","service":"payment-service"}', lineNumber: 1 },
      { line: '2024-03-08T14:02:13Z {"level":"error","msg":"connection refused","service":"payment-service"}', lineNumber: 2 },
    ];
    const result = runMockAnalysis(raw);
    expect(result.summary.impactedServices.length).toBeGreaterThan(0);
    expect(result.summary.likelyRootCause).toBeTruthy();
    expect(result.summary.suggestedNextSteps.length).toBeGreaterThan(0);
  });

  it("parses events and sets rawLineCount", () => {
    const raw = [
      { line: "2024-03-08T14:02:00Z event one", lineNumber: 1 },
      { line: "2024-03-08T14:02:01Z event two", lineNumber: 2 },
    ];
    const result = runMockAnalysis(raw);
    expect(result.rawLineCount).toBe(2);
    expect(result.events.length).toBeGreaterThan(0);
  });
});
