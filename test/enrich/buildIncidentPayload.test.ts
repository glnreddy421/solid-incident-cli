import { describe, expect, it } from "vitest";
import { analyzeLocally } from "../../src/engine/analysisEngine.js";
import { buildIncidentEnrichmentPayload } from "../../src/enrich/payload/buildIncidentPayload.js";
import { safeSerializePayload } from "../../src/enrich/payload/sanitizePayload.js";

describe("buildIncidentEnrichmentPayload", () => {
  it("builds a stable structured payload", () => {
    const analysis = analyzeLocally({
      rawLines: [
        { line: "[2025-01-01T00:00:00Z] payment error timeout upstream", lineNumber: 1, source: "file", sourceName: "a.log" },
        { line: "[2025-01-01T00:00:01Z] gateway warn retry", lineNumber: 2, source: "file", sourceName: "a.log" },
      ],
      inputSources: [{ kind: "file", name: "a.log" }],
      mode: "text",
    });

    const payload = buildIncidentEnrichmentPayload(analysis);
    expect(payload.schemaVersion).toBe("incident-enrichment.v1");
    expect(payload.incident.verdict).toBe(analysis.assessment.verdict);
    expect(payload.source.engineVersion).toBe(analysis.schema.schemaVersion);
    expect(Array.isArray(payload.timeline)).toBe(true);
    expect(payload.timeline.length).toBeGreaterThan(0);
    expect(Array.isArray(payload.rootCauseCandidates)).toBe(true);
  });

  it("truncates large fields, caps list sizes, and reports truncation metadata", () => {
    const analysis = analyzeLocally({
      rawLines: Array.from({ length: 90 }, (_, index) => ({
        line: `[2025-01-01T00:00:${String(index % 60).padStart(2, "0")}Z] api error ${"x".repeat(300)}`,
        lineNumber: index + 1,
        source: "file" as const,
        sourceName: "big.log",
      })),
      inputSources: [{ kind: "file", name: "big.log" }],
      mode: "text",
    });

    const payload = buildIncidentEnrichmentPayload(analysis, {
      maxTimelineEntries: 10,
      maxStringLength: 80,
      maxSignals: 3,
      maxCandidates: 1,
      maxExcerpts: 2,
    });
    expect(payload.timeline.length).toBeLessThanOrEqual(10);
    expect(payload.signals.length).toBeLessThanOrEqual(3);
    expect(payload.timeline.every((entry) => (entry.message ?? "").length <= 83)).toBe(true);
    expect(payload.metadata.truncation.timelineEntriesDropped).toBeGreaterThanOrEqual(0);
    expect(payload.metadata.truncation.signalsDropped).toBeGreaterThanOrEqual(0);
    expect(payload.metadata.truncation.candidatesDropped).toBeGreaterThanOrEqual(0);
    expect(payload.metadata.truncation.excerptsDropped).toBeGreaterThanOrEqual(0);
  });

  it("clamps confidence and health ranges", () => {
    const analysis = analyzeLocally({
      rawLines: [{ line: "service unavailable", lineNumber: 1, source: "stdin", sourceName: "stdin" }],
      inputSources: [{ kind: "stdin", name: "stdin" }],
      mode: "text",
    });
    analysis.summary.confidence = 200;
    analysis.assessment.healthScore = 150;
    analysis.diagnostics.parseCoverage = 150;

    const payload = buildIncidentEnrichmentPayload(analysis);
    expect(payload.incident.confidence).toBe(1);
    expect(payload.incident.healthScore).toBe(100);
    expect(payload.trust?.parseCoverage).toBe(1);
  });

  it("handles missing optional fields and deterministic serialization", () => {
    const analysis = analyzeLocally({
      rawLines: [{ line: "service unavailable", lineNumber: 1, source: "stdin", sourceName: "stdin" }],
      inputSources: [{ kind: "stdin", name: "stdin" }],
      mode: "text",
    });

    analysis.parsedEvents = undefined;
    analysis.correlationSnapshot = undefined;

    const payload = buildIncidentEnrichmentPayload(analysis);
    expect(payload.correlation).toBeUndefined();
    expect(Array.isArray(payload.evidenceExcerpts)).toBe(true);
    expect(safeSerializePayload(payload)).toBe(safeSerializePayload(payload));
  });
});
