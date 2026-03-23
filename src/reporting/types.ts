/**
 * Deterministic report rendering (no LLM). Formats existing engine output only.
 */

export type ReportStyle = "rca" | "star" | "car" | "executive" | "debug" | "timeline";

/** Output certainty for wording — see analysisState.ts */
export type ReportState = "final" | "snapshot" | "live" | "partial";

export interface RenderReportOptions {
  style: ReportStyle;
  /** Override auto-detected state from `AnalysisResult.metadata.analysisContext` */
  state?: ReportState;
  polish?: boolean;
  includeConfidence?: boolean;
  includeTrustNotes?: boolean;
  includeSuggestedFixes?: boolean;
}

export interface RenderedReport {
  style: ReportStyle;
  state: ReportState;
  title: string;
  /** Section id → markdown body (no leading # for title) */
  rawSections: Record<string, string>;
  /** Assembled markdown before/after polish */
  finalText: string;
  metadata: {
    polished: boolean;
    generatedAt: string;
  };
}

export interface TemplateContext {
  state: ReportState;
  includeConfidence: boolean;
  includeTrustNotes: boolean;
  includeSuggestedFixes: boolean;
}
