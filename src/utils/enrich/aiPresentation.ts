/**
 * Prefer AI enrichment output when present; fall back to engine fields per section.
 */

import type { AiAnalysis, AnalysisResult } from "../../contracts/model.js";

/** True when backend returned usable AI content (not just available flag). */
export function aiHasUsableContent(ai: AiAnalysis): boolean {
  if (!ai.available) return false;
  const hasText = Boolean(
    (ai.enrichedSummary && ai.enrichedSummary.trim()) ||
      (ai.operatorNarrative && ai.operatorNarrative.trim()) ||
      (ai.summary && ai.summary.trim())
  );
  const hasRanked = (ai.rankedRootCauseCandidates?.length ?? 0) > 0;
  const hasLegacyCauses = (ai.rootCauseCandidates?.length ?? 0) > 0;
  const hasChecks =
    (ai.refinedRecommendedChecks?.length ?? 0) > 0 || (ai.recommendedChecks?.length ?? 0) > 0;
  const hasFollowUps = (ai.followUpQuestions?.length ?? 0) > 0;
  const hasMeta =
    (ai.caveats?.length ?? 0) > 0 ||
    Boolean(ai.confidenceStatement && ai.confidenceStatement.trim().length > 0);
  return hasText || hasRanked || hasLegacyCauses || hasChecks || hasFollowUps || hasMeta;
}

/** Primary headline for operators (AI first). */
export function aiPrimaryHeadline(ai: AiAnalysis): string {
  return (
    (ai.enrichedSummary && ai.enrichedSummary.trim()) ||
    (ai.operatorNarrative && ai.operatorNarrative.trim()) ||
    (ai.summary && ai.summary.trim()) ||
    ""
  );
}

/** Timeline story: AI if present, else engine. */
export function aiOrEngineTimelineNarrative(ai: AiAnalysis, engineFallback: string): string {
  const t = ai.timelineNarrative?.trim();
  if (ai.available && t) return t;
  return engineFallback || "No timeline narrative.";
}

/** Root cause lines for display: prefer ranked v2, then legacy strings, then engine. */
export function displayRootCauseLines(
  ai: AiAnalysis,
  engineCandidates: AnalysisResult["assessment"]["rootCauseCandidates"]
): string[] {
  if (ai.available && ai.rankedRootCauseCandidates?.length) {
    return ai.rankedRootCauseCandidates.map((r, i) => {
      const conf = r.confidenceLabel ?? (r.confidenceValue != null ? `${Math.round(r.confidenceValue * 100)}%` : "");
      const head = `${i + 1}. ${r.label}${conf ? ` (${conf})` : ""}`;
      const rat = r.rationale?.trim();
      const cave = r.caveats?.filter(Boolean).length ? ` — Note: ${r.caveats!.slice(0, 2).join("; ")}` : "";
      const ev = r.supportingEvidenceRefs?.length ? ` [ev: ${r.supportingEvidenceRefs.slice(0, 4).join(", ")}]` : "";
      return rat ? `${head}\n   ${rat}${ev}${cave}` : `${head}${ev}${cave}`;
    });
  }
  if (ai.available && ai.rootCauseCandidates?.length) {
    return ai.rootCauseCandidates.map((c, i) => `${i + 1}. ${c}`);
  }
  if (engineCandidates?.length) {
    return engineCandidates.slice(0, 5).map(
      (rc, i) => `${i + 1}. ${rc.label ?? rc.id} (${Math.round(rc.confidence * 100)}%) — ${rc.evidence ?? "see assessment"}`,
    );
  }
  return ["No root-cause candidates identified."];
}

/** Recommended actions: prefer refined checks with rationale. */
export function displayRecommendedLines(ai: AiAnalysis, engineActions: string[]): string[] {
  if (ai.available && ai.refinedRecommendedChecks?.length) {
    return ai.refinedRecommendedChecks.map((r, i) => {
      const p = r.priority ? `[${r.priority}] ` : "";
      const why = r.whyItMatters?.trim();
      const link = r.linkedCandidateLabel ? ` → ${r.linkedCandidateLabel}` : "";
      return why ? `${p}${i + 1}. ${r.text}\n   Why: ${why}${link}` : `${p}${i + 1}. ${r.text}${link}`;
    });
  }
  if (ai.available && ai.recommendedChecks?.length) {
    return ai.recommendedChecks.map((c, i) => `${i + 1}. ${c}`);
  }
  if (engineActions.length) {
    return engineActions.map((a, i) => `${i + 1}. ${a}`);
  }
  return ["No specific checks suggested."];
}
