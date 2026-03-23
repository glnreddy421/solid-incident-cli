import type { AnalysisResult } from "../../contracts/index.js";
import type { ReportState } from "../types.js";

/**
 * Derive report wording state from explicit override, run metadata, and evidence strength.
 */
export function resolveReportState(result: AnalysisResult, explicit?: ReportState): ReportState {
  if (explicit) return explicit;

  const ctx = result.metadata.analysisContext;
  if (ctx?.runKind === "live") {
    if (ctx.streamFinalized) return "final";
    return "live";
  }
  if (ctx?.runKind === "snapshot") return "snapshot";

  if (result.assessment.verdict === "INSUFFICIENT EVIDENCE") return "partial";

  const conf = result.summary.confidence ?? 0;
  const parseCov = result.diagnostics.parseCoverage ?? 1;
  const fewEvents = result.timeline.length < 3;
  if (conf < 38 && fewEvents) return "partial";
  if (parseCov < 0.3 && result.timeline.length < 4) return "partial";

  return "final";
}

export function stateBannerTitle(state: ReportState): string | null {
  switch (state) {
    case "live":
      return "Live incident snapshot";
    case "snapshot":
      return "Point-in-time assessment";
    case "partial":
      return "Partial assessment (limited evidence)";
    default:
      return null;
  }
}

export function stateFooterNote(state: ReportState): string | null {
  switch (state) {
    case "live":
      return "This summary reflects the currently available event stream and may change as additional logs arrive.";
    case "snapshot":
      return "This assessment is based on the current log window only and may evolve if more data is analyzed.";
    case "partial":
      return "Evidence is sparse or ambiguous; treat conclusions as tentative and gather more telemetry.";
    default:
      return null;
  }
}

/** RCA / narrative tense helpers */
export function triggerPhrase(state: ReportState): string {
  return state === "final" ? "The incident was triggered by" : "The strongest trigger signal so far involves";
}

export function rootCausePhrase(state: ReportState): string {
  return state === "final" ? "The most likely root cause is" : "At this point, the most likely cause appears to be";
}

export function propagationPhrase(state: ReportState): string {
  return state === "final" ? "The propagation path was" : "The currently observed propagation path suggests";
}

export function affectedPhrase(state: ReportState): string {
  return state === "final" ? "Affected services were" : "The following services appear affected in the current window";
}

export function timelineIntro(state: ReportState): string {
  return state === "final" ? "Chronology (from engine timeline):" : "Sequence observed in the current window:";
}
