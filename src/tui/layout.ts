import type { AnalysisResult, TuiPanelId, TuiState } from "../contracts/index.js";
import { PANEL_SPECS } from "./panelSpecs.js";
import type { TuiLayoutContext } from "./layoutContext.js";

export interface LayoutRender {
  topStrip: string[];
  mainPanel: string[];
  sidePanel: string[];
  footer: string[];
}

const PANEL_NUMBER: Record<TuiPanelId, string> = {
  summary: "1",
  timeline: "2",
  "trace-graph": "3",
  mindmap: "4",
  signals: "5",
  evidence: "6",
  "ai-analysis": "7",
  reports: "8",
  diagnostics: "9",
};

function sectionHeader(title: string): string {
  return `-- ${title} --`;
}

export function renderLayout(
  result: AnalysisResult,
  state: TuiState,
  isLive: boolean,
  liveStatus: string,
  layoutCtx: TuiLayoutContext,
): LayoutRender {
  const spec = PANEL_SPECS[state.activePanel];
  const services = `${result.assessment.serviceCount}`;
  const warnings = result.diagnostics.warnings.length;
  const liveTag = isLive ? `LIVE:${liveStatus}` : "BATCH";

  const topStrip = [
    `SOLID Incident Console   ${liveTag}   Panel ${PANEL_NUMBER[state.activePanel]} ${spec.title}`,
    `Trigger: ${result.assessment.triggerService} -> ${result.assessment.triggerEvent.slice(0, 42)} | Confidence: ${result.summary.confidence}% | Services analyzed: ${services}`,
    `Window: ${result.summary.incidentWindow.start} -> ${result.summary.incidentWindow.end} | Verdict: ${result.assessment.verdict} | Warnings: ${warnings} | Focus: ${state.focusRegion ?? "main"}`,
  ];

  const main = [sectionHeader(spec.title), ...spec.main(result, state.filter, state.searchQuery, layoutCtx)];
  const side = [sectionHeader("Context"), ...spec.side(result, state.filter, state.searchQuery, layoutCtx)];

  const hr = result.heuristicReports;
  const hrTag = [hr?.rca ? "rca" : null, hr?.interview ? "star" : null].filter(Boolean).join("+") || "—";
  const footer = [
    "1-9 panels  tab focus  / f  t s  a AI  g refresh  n BYO  R/I reports  e w x  ? q",
    state.message
      ? `Status: ${state.message}`
      : `Status: Ready | logs=${result.metadata.rawLineCount} signals=${result.signals.length} followUps=${(result.ai.followUpArtifacts ?? []).length} engineReports=${hrTag}`,
  ];

  return {
    // Do not hard-trim here; renderer handles dynamic row budgeting.
    topStrip,
    mainPanel: main,
    sidePanel: side,
    footer,
  };
}

