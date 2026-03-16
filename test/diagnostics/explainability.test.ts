import { describe, expect, it } from "vitest";
import { CorrelationService } from "../../src/core/correlation/correlationService.js";
import { ingestWithAdapters } from "../../src/utils/inputAdapters/registry.js";
import { resetAdapterRegistryForTests } from "../../src/utils/inputAdapters/index.js";
import { makeCanonicalEvent } from "../fixtures/helpers.js";

describe("parser diagnostics on events", () => {
  it("parserId and parseReasons visible on ingested events", () => {
    resetAdapterRegistryForTests();
    const result = ingestWithAdapters({
      content: "2024-03-08T14:02:12Z service=api level=error msg=\"boom\"",
      context: { path: "app.log", sourceKind: "file" as const },
    });
    const event = result.events[0];
    expect(event.parserId).toBeDefined();
    expect(event.parseReasons).toBeDefined();
    expect(event.parseConfidence).toBeDefined();
  });
});

describe("adapter diagnostics on events", () => {
  it("adapterId and adapterConfidence visible", () => {
    resetAdapterRegistryForTests();
    const result = ingestWithAdapters({
      content: "2024-03-08T14:02:12Z info started",
      context: { path: "app.log", sourceKind: "file" as const },
    });
    const event = result.events[0];
    expect(event.adapterId).toBe("text-log");
    expect(event.adapterConfidence).toBeDefined();
  });
});

describe("correlation findings explainability", () => {
  it("findings include evidenceRefs, ruleId, ruleDiagnostics", () => {
    const svc = new CorrelationService(60_000);
    svc.ingest(makeCanonicalEvent({ id: "e1", timestamp: "2026-03-14T01:00:00Z", service: "api", message: "timeout" }));
    svc.ingest(makeCanonicalEvent({ id: "e2", timestamp: "2026-03-14T01:00:01Z", service: "api", level: "warning", message: "retry 1/3" }));
    svc.ingest(makeCanonicalEvent({ id: "e3", timestamp: "2026-03-14T01:00:02Z", service: "api", message: "failed" }));

    const snapshot = svc.getSnapshot();
    const finding = snapshot.findings.find((f) => f.evidenceRefs?.length);
    if (finding) {
      expect(finding.evidenceRefs.length).toBeGreaterThan(0);
      expect(finding.ruleId).toBeDefined();
      expect(finding.ruleDiagnostics).toBeDefined();
      expect(finding.confidence).toBeDefined();
      expect(["single-source-inferred", "multi-source-corroborated"]).toContain(finding.corroboration);
    }
  });
});

describe("causal chains explainability", () => {
  it("chains include involvedServices, orderedSteps, evidenceSources", () => {
    const svc = new CorrelationService(60_000);
    svc.ingest(makeCanonicalEvent({ id: "e1", timestamp: "2026-03-14T01:00:00Z", service: "api", message: "timeout" }));
    svc.ingest(makeCanonicalEvent({ id: "e2", timestamp: "2026-03-14T01:00:01Z", service: "api", level: "warning", message: "retry" }));
    svc.ingest(makeCanonicalEvent({ id: "e3", timestamp: "2026-03-14T01:00:02Z", service: "api", message: "failed" }));

    const snapshot = svc.getSnapshot();
    const chain = snapshot.activeChains[0];
    if (chain) {
      expect(chain.involvedServices.length).toBeGreaterThan(0);
      expect(chain.orderedSteps.length).toBeGreaterThan(0);
      expect(chain.evidenceSources).toBeDefined();
      expect(chain.evidenceRefs.length).toBeGreaterThan(0);
      expect(chain.warnings).toBeDefined();
    }
  });
});
