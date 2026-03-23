import { describe, expect, it } from "vitest";
import { analyzeLocally } from "../../src/engine/analysisEngine.js";
import { buildEnrichRequest } from "../../src/utils/enrich/buildEnrichRequest.js";
import { normalizeEnrichResponse } from "../../src/api/enrichResponse.js";

describe("buildEnrichRequest", () => {
  it("includes evidence, findings, ruleDiagnostics, missingEvidence, structured checks", () => {
    const result = analyzeLocally({
      rawLines: [
        { line: "[2025-01-01T12:00:00Z] payment error connection refused", lineNumber: 1, source: "file", sourceName: "a.log" },
        { line: "[2025-01-01T12:00:01Z] gateway timeout upstream", lineNumber: 2, source: "file", sourceName: "a.log" },
      ],
      inputSources: [{ kind: "file", name: "a.log" }],
      mode: "text",
    });

    const req = buildEnrichRequest(result, { mode: "batch", incidentId: "inc-test" });
    expect(req.enrichVersion).toBe("2.0");
    expect(req.metadata.incidentId).toBe("inc-test");
    expect(req.evidence.length).toBeGreaterThan(0);
    expect(req.findings.length).toBeGreaterThan(0);
    expect(req.causalChains.length).toBeGreaterThan(0);
    expect(req.rootCauseCandidates.length).toBeGreaterThan(0);
    expect(req.ruleDiagnostics.length).toBeGreaterThan(0);
    expect(req.missingEvidenceAndUncertainty.length).toBeGreaterThan(0);
    expect(req.recommendedChecks.every((c) => c.checkId && c.text && c.reason)).toBe(true);
    expect(req.layering.observedEventIds.length).toBe(req.evidence.length);
    expect(req.legacySchema).toBe(result.schema);
  });
});

describe("normalizeEnrichResponse", () => {
  it("maps v2 payload to AiAnalysis with ranked + legacy fields", () => {
    const ai = normalizeEnrichResponse({
      enrichResponseVersion: "2.0",
      available: true,
      enrichedSummary: "S",
      operatorNarrative: "O",
      timelineNarrative: "T",
      rankedRootCauseCandidates: [
        { label: "L1", rationale: "r", supportingEvidenceRefs: ["e1"], caveats: ["c"] },
      ],
      refinedRecommendedChecks: [{ text: "chk", whyItMatters: "w", priority: "medium" }],
      followUpQuestions: ["q1"],
      caveats: ["global"],
      confidenceStatement: "low confidence",
    });
    expect(ai.enrichResponseVersion).toBe("2.0");
    expect(ai.summary).toBe("S");
    expect(ai.rootCauseCandidates).toEqual(["L1"]);
    expect(ai.recommendedChecks).toEqual(["chk"]);
    expect(ai.rankedRootCauseCandidates?.[0].label).toBe("L1");
  });

  it("handles sparse legacy payload without crash", () => {
    const ai = normalizeEnrichResponse({
      available: true,
      summary: "old",
      timelineNarrative: "t",
      rootCauseCandidates: ["x"],
      followUpQuestions: [],
      recommendedChecks: [],
    });
    expect(ai.summary).toBe("old");
    expect(ai.rootCauseCandidates).toEqual(["x"]);
  });
});
