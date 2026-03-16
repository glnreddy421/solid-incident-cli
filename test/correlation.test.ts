import { describe, expect, it } from "vitest";
import { CorrelationService } from "../src/core/correlation/correlationService.js";
import { registerCorrelationRule, resetCorrelationRulesForTests } from "../src/core/correlation/rules.js";
import type { CanonicalEvent } from "../src/utils/inputAdapters/types.js";

function makeEvent(partial: Partial<CanonicalEvent> & { id: string; timestamp: string; message: string }): CanonicalEvent {
  return {
    type: "log",
    source: "test",
    sourceType: "file",
    sourceName: partial.sourceName ?? "test.log",
    sourcePath: partial.sourcePath ?? "/tmp/test.log",
    sourceId: partial.sourceId ?? "src-1",
    service: partial.service ?? "api",
    level: partial.level ?? "error",
    receivedAt: partial.timestamp,
    ...partial,
  };
}

describe("CorrelationService", () => {
  it("exposes deterministic rule diagnostics and supports custom rule registration", () => {
    resetCorrelationRulesForTests();
    registerCorrelationRule({
      id: "custom-test-rule",
      run: (events) =>
        events.length > 0
          ? {
              findings: [{
                id: "finding-custom-test",
                findingId: "finding-custom-test",
                key: "custom:test",
                title: "Custom test finding",
                summary: "custom rule fired",
                description: "custom rule fired",
                severity: "warning",
                confidence: 0.41,
                overallConfidence: 0.41,
                evidence: [{ eventId: events[0].id ?? "x", explanation: "custom evidence" }],
                evidenceRefs: [{ eventId: events[0].id ?? "x", explanation: "custom evidence" }],
                services: [events[0].service ?? "unknown-service"],
                sourceIds: [events[0].sourceId ?? "src"],
                corroboration: "single-source-inferred",
                strength: "single-source-inferred",
                reasons: ["custom rule execution"],
                ruleId: "custom-test-rule",
                ruleName: "Custom test rule",
                ruleDiagnostics: {
                  reasonsTriggered: ["custom rule execution"],
                  confidenceAdjustments: [],
                  evidenceEventIds: [events[0].id ?? "x"],
                },
              }],
            }
          : {},
    });
    const svc = new CorrelationService(60_000);
    svc.ingest(makeEvent({ id: "r1", timestamp: "2026-03-14T01:00:00Z", message: "noise" }));
    const snapshot = svc.getSnapshot();
    expect(snapshot.diagnostics.ruleExecutionOrder.at(-1)).toBe("custom-test-rule");
    expect(snapshot.diagnostics.ruleHits["custom-test-rule"]).toBe(1);
    expect(snapshot.findings.some((finding) => finding.id === "finding-custom-test")).toBe(true);
    expect(snapshot.findings.some((finding) => finding.ruleDiagnostics?.reasonsTriggered.includes("custom rule execution"))).toBe(true);
    resetCorrelationRulesForTests();
  });

  it("builds single-source inferred chain with moderate confidence", () => {
    const svc = new CorrelationService(60_000);
    const events = [
      makeEvent({ id: "e1", timestamp: "2026-03-14T01:00:00Z", service: "api", message: "timeout calling db" }),
      makeEvent({ id: "e2", timestamp: "2026-03-14T01:00:01Z", service: "api", level: "warning", message: "retry attempt 1/3" }),
      makeEvent({ id: "e3", timestamp: "2026-03-14T01:00:02Z", service: "api", message: "failed dependency request" }),
    ];
    for (const event of events) svc.ingest(event);
    const snapshot = svc.getSnapshot();
    const chain = snapshot.activeChains[0];
    expect(chain).toBeDefined();
    expect(chain.corroboration).toBe("single-source-inferred");
    expect(chain.strength).toBe("single-source-inferred");
    expect(chain.confidence).toBeLessThan(0.8);
    expect(chain.reasons.length).toBeGreaterThan(0);
    expect(chain.orderedSteps.length).toBeGreaterThan(0);
    expect(chain.evidenceRefs.length).toBeGreaterThan(0);
    expect(chain.ruleDiagnostics?.evidenceEventIds.length).toBeGreaterThan(0);
    expect(snapshot.diagnostics.ruleHits["timeout-retry-failure-chain"]).toBeGreaterThanOrEqual(1);
  });

  it("upgrades to stronger chain with multi-source corroboration", () => {
    const svc = new CorrelationService(60_000);
    const events = [
      makeEvent({ id: "e1", timestamp: "2026-03-14T01:00:00Z", sourceId: "auth-src", service: "auth", message: "timeout calling db" }),
      makeEvent({ id: "e2", timestamp: "2026-03-14T01:00:01Z", sourceId: "auth-src", service: "auth", level: "warning", message: "retry attempt 1/3" }),
      makeEvent({ id: "e3", timestamp: "2026-03-14T01:00:02Z", sourceId: "gw-src", service: "auth", message: "failed auth upstream timeout" }),
      makeEvent({ id: "e4", timestamp: "2026-03-14T01:00:03Z", sourceId: "gw-src", service: "gateway", message: "503 user request failed" }),
    ];
    for (const event of events) svc.ingest(event);
    const snapshot = svc.getSnapshot();
    const best = snapshot.findings[0];
    expect(best.corroboration).toBe("multi-source-corroborated");
    expect(best.confidence).toBeGreaterThan(0.7);
    expect(["multi-source-corroborated", "high-confidence-cross-source"]).toContain(best.strength);
    expect(best.evidenceRefs.length).toBeGreaterThan(0);
  });

  it("does not group noisy unrelated singleton events incorrectly", () => {
    const svc = new CorrelationService(120_000);
    const noisy = [
      makeEvent({ id: "n1", timestamp: "2026-03-14T01:10:00Z", sourceId: "a", service: "auth", message: "user logged in", level: "info" }),
      makeEvent({ id: "n2", timestamp: "2026-03-14T01:10:40Z", sourceId: "b", service: "payments", message: "invoice generated", level: "info" }),
      makeEvent({ id: "n3", timestamp: "2026-03-14T01:11:20Z", sourceId: "c", service: "search", message: "cache warmup complete", level: "info" }),
    ];
    for (const event of noisy) svc.ingest(event);
    const snapshot = svc.getSnapshot();
    expect(snapshot.correlatedGroups.length).toBe(0);
    expect(snapshot.findings.length).toBe(0);
  });

  it("is deterministic across repeated runs", () => {
    const run = (): string[] => {
      const svc = new CorrelationService(60_000);
      const events = [
        makeEvent({ id: "d1", timestamp: "2026-03-14T01:00:00Z", service: "api", message: "timeout calling db" }),
        makeEvent({ id: "d2", timestamp: "2026-03-14T01:00:01Z", service: "api", level: "warning", message: "retry attempt 1/3" }),
        makeEvent({ id: "d3", timestamp: "2026-03-14T01:00:02Z", service: "api", message: "failed dependency request" }),
      ];
      for (const event of events) svc.ingest(event);
      return svc.getSnapshot().findings.map((finding) => `${finding.id}:${finding.confidence}:${finding.strength}`);
    };
    expect(run()).toEqual(run());
  });

  it("evicts old events deterministically as window advances", () => {
    const svc = new CorrelationService(2_000);
    svc.ingest(makeEvent({ id: "o1", timestamp: "2026-03-14T01:00:00Z", message: "timeout calling db" }));
    svc.ingest(makeEvent({ id: "o2", timestamp: "2026-03-14T01:00:01Z", message: "retry attempt 1/3", level: "warning" }));
    svc.ingest(makeEvent({ id: "o3", timestamp: "2026-03-14T01:00:20Z", message: "healthy heartbeat", level: "info" }));
    const snapshot = svc.getSnapshot();
    expect(snapshot.snapshot.totalEvents).toBe(1);
    expect(snapshot.timeline[0].id).toBe("o3");
    expect(snapshot.mergedTimeline[0].id).toBe("o3");
  });
});

