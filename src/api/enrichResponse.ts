import type { AiAnalysis, AiRankedRootCause, AiRefinedCheck } from "../contracts/model.js";

/** Raw JSON from POST /api/incident/enrich */
export type EnrichApiPayload = Record<string, unknown>;

function isObject(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === "object" && !Array.isArray(x);
}

function asStringArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((i): i is string => typeof i === "string") : [];
}

function mapRanked(x: unknown): AiRankedRootCause[] {
  if (!Array.isArray(x)) return [];
  return x.map((row): AiRankedRootCause => {
    if (!isObject(row)) {
      return { label: String(row), rationale: "", supportingEvidenceRefs: [], caveats: [] };
    }
    return {
      label: typeof row.label === "string" ? row.label : "",
      confidenceValue: typeof row.confidenceValue === "number" ? row.confidenceValue : undefined,
      confidenceLabel: typeof row.confidenceLabel === "string" ? row.confidenceLabel : undefined,
      rationale: typeof row.rationale === "string" ? row.rationale : "",
      supportingEvidenceRefs: asStringArray(row.supportingEvidenceRefs),
      caveats: asStringArray(row.caveats),
    };
  });
}

function mapRefined(x: unknown): AiRefinedCheck[] {
  if (!Array.isArray(x)) return [];
  return x.map((row): AiRefinedCheck => {
    if (!isObject(row)) {
      return { text: String(row), whyItMatters: "", priority: "medium" };
    }
    const pr = row.priority;
    const priority: AiRefinedCheck["priority"] =
      pr === "low" || pr === "medium" || pr === "high" ? pr : "medium";
    return {
      text: typeof row.text === "string" ? row.text : "",
      whyItMatters: typeof row.whyItMatters === "string" ? row.whyItMatters : "",
      priority,
      linkedCandidateLabel: typeof row.linkedCandidateLabel === "string" ? row.linkedCandidateLabel : undefined,
    };
  });
}

/**
 * Normalizes backend JSON into AiAnalysis.
 * Supports v2 (enrichResponseVersion) and legacy flat fields.
 */
export function normalizeEnrichResponse(payload: EnrichApiPayload): AiAnalysis {
  const v2 = payload.enrichResponseVersion === "2.0";

  if (v2) {
    const ranked = mapRanked(payload.rankedRootCauseCandidates);
    const refined = mapRefined(payload.refinedRecommendedChecks);
    const enrichedSummary = typeof payload.enrichedSummary === "string" ? payload.enrichedSummary : "";
    const operatorNarrative = typeof payload.operatorNarrative === "string" ? payload.operatorNarrative : "";
    const timelineNarrative = typeof payload.timelineNarrative === "string" ? payload.timelineNarrative : "";

    return {
      available: payload.available !== false,
      summary: enrichedSummary || operatorNarrative,
      enrichedSummary,
      operatorNarrative,
      timelineNarrative,
      rankedRootCauseCandidates: ranked,
      refinedRecommendedChecks: refined,
      rootCauseCandidates: ranked.map((r) => r.label).filter(Boolean),
      followUpQuestions: asStringArray(payload.followUpQuestions),
      caveats: asStringArray(payload.caveats),
      confidenceStatement: typeof payload.confidenceStatement === "string" ? payload.confidenceStatement : "",
      recommendedChecks: refined.map((r) => r.text).filter(Boolean),
      reports: isObject(payload.reports) ? (payload.reports as AiAnalysis["reports"]) : {},
      warning: typeof payload.warning === "string" ? payload.warning : undefined,
      enrichResponseVersion: "2.0",
    };
  }

  return {
    available: payload.available !== false,
    summary: typeof payload.summary === "string" ? payload.summary : "AI summary unavailable.",
    timelineNarrative: typeof payload.timelineNarrative === "string" ? payload.timelineNarrative : "Timeline narrative unavailable.",
    rootCauseCandidates: asStringArray(payload.rootCauseCandidates),
    followUpQuestions: asStringArray(payload.followUpQuestions),
    recommendedChecks: asStringArray(payload.recommendedChecks),
    reports: isObject(payload.reports) ? (payload.reports as AiAnalysis["reports"]) : {},
    warning: typeof payload.warning === "string" ? payload.warning : undefined,
  };
}
