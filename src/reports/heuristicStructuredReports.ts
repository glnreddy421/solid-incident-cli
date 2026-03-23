/**
 * Structured RCA and STAR narratives from the **analysis engine only** (topology, scoring,
 * signals, timelines, assessment). Does **not** read or merge `result.ai` / LLM enrichment —
 * safe to generate before AI completes or with AI disabled.
 *
 * Markdown is produced by the deterministic `reporting` layer (templates + rule-based polish).
 */

import type { AnalysisResult, HeuristicReportKind, HeuristicReportSnapshot } from "../contracts/model.js";
import { renderReport } from "../reporting/renderReport.js";

/** Industry-style RCA from engine data only (no LLM). Wording follows `metadata.analysisContext` (live vs final). */
export function buildHeuristicRcaReport(result: AnalysisResult): string {
  return renderReport(result, { style: "rca", polish: true }).finalText;
}

/** STAR narrative — engine fields only; state-aware phrasing for live tail. */
export function buildHeuristicInterviewStory(result: AnalysisResult): string {
  return renderReport(result, { style: "star", polish: true }).finalText;
}

/**
 * Mutates `result.heuristicReports` with a fresh snapshot from the **current** engine state.
 * Explicit user action only (CLI / TUI / web). Ignores AI enrichment by design.
 */
export function applyHeuristicReport(result: AnalysisResult, kind: HeuristicReportKind): HeuristicReportSnapshot {
  const rendered =
    kind === "rca"
      ? renderReport(result, { style: "rca", polish: true })
      : renderReport(result, { style: "star", polish: true });
  const snapshot: HeuristicReportSnapshot = { kind, markdown: rendered.finalText, generatedAt: new Date().toISOString() };
  if (!result.heuristicReports) result.heuristicReports = {};
  if (kind === "rca") result.heuristicReports.rca = snapshot;
  else result.heuristicReports.interview = snapshot;
  return snapshot;
}
