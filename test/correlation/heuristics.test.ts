import { describe, expect, it } from "vitest";
import {
  detectConnectionFailureClusters,
  detectCrossSourcePropagationFindings,
  detectErrorBurstFindings,
  detectTimeoutRetryFailureChains,
  detectUserVisibleBackendCorroboration,
} from "../../src/core/correlation/heuristics.js";
import { makeCanonicalEvent } from "../fixtures/helpers.js";

describe("timeout-retry-failure heuristic", () => {
  it("emits chain for timeout -> retry -> failure pattern", () => {
    const events = [
      makeCanonicalEvent({ id: "e1", timestamp: "2026-03-14T01:00:00Z", service: "api", message: "timeout calling db" }),
      makeCanonicalEvent({ id: "e2", timestamp: "2026-03-14T01:00:01Z", service: "api", level: "warning", message: "retry attempt 1/3" }),
      makeCanonicalEvent({ id: "e3", timestamp: "2026-03-14T01:00:02Z", service: "api", message: "failed dependency request" }),
    ];
    const chains = detectTimeoutRetryFailureChains(events);
    expect(chains.length).toBeGreaterThanOrEqual(1);
    expect(chains[0].ruleId).toBe("timeout-retry-failure-chain");
    expect(chains[0].orderedSteps.length).toBe(3);
    expect(chains[0].probableTrigger).toBeDefined();
    expect(chains[0].evidenceRefs.length).toBeGreaterThan(0);
  });
});

describe("error-burst heuristic", () => {
  it("emits finding for repeated errors", () => {
    const events = [
      makeCanonicalEvent({ id: "e1", timestamp: "2026-03-14T01:00:00Z", service: "api", message: "error one" }),
      makeCanonicalEvent({ id: "e2", timestamp: "2026-03-14T01:00:01Z", service: "api", message: "error two" }),
      makeCanonicalEvent({ id: "e3", timestamp: "2026-03-14T01:00:02Z", service: "api", message: "error three" }),
    ];
    const findings = detectErrorBurstFindings(events);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].ruleId).toBe("error-burst");
    expect(findings[0].evidenceRefs.length).toBeGreaterThan(0);
  });
});

describe("cross-source propagation heuristic", () => {
  it("emits finding when failures across multiple sources", () => {
    const events = [
      makeCanonicalEvent({ id: "e1", timestamp: "2026-03-14T01:00:00Z", sourceId: "a", service: "auth", message: "connection refused" }),
      makeCanonicalEvent({ id: "e2", timestamp: "2026-03-14T01:00:01Z", sourceId: "b", service: "gateway", message: "503 upstream" }),
    ];
    const findings = detectCrossSourcePropagationFindings(events);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].corroboration).toBe("multi-source-corroborated");
  });
});

describe("user-visible backend corroboration heuristic", () => {
  it("emits finding when backend and user-facing failures align", () => {
    const events = [
      makeCanonicalEvent({ id: "e1", timestamp: "2026-03-14T01:00:00Z", service: "postgres", message: "connection failed" }),
      makeCanonicalEvent({ id: "e2", timestamp: "2026-03-14T01:00:01Z", service: "gateway", message: "user request failed 503" }),
    ];
    const findings = detectUserVisibleBackendCorroboration(events);
    expect(findings.length).toBeGreaterThanOrEqual(1);
  });
});

describe("connection failure cluster heuristic", () => {
  it("emits finding for repeated connection failures", () => {
    const events = [
      makeCanonicalEvent({ id: "e1", timestamp: "2026-03-14T01:00:00Z", service: "api", message: "connection refused" }),
      makeCanonicalEvent({ id: "e2", timestamp: "2026-03-14T01:00:01Z", service: "api", message: "ECONNREFUSED" }),
      makeCanonicalEvent({ id: "e3", timestamp: "2026-03-14T01:00:02Z", service: "api", message: "connect failed" }),
    ];
    const findings = detectConnectionFailureClusters(events);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].ruleId).toBe("connection-failure-cluster");
  });
});
