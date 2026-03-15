import type { AnalysisResult, TuiPanelId, TuiState } from "../contracts/index.js";
import { PANEL_SPECS } from "./panelSpecs.js";

export interface LayoutRender {
  topStrip: string[];
  mainPanel: string[];
  sidePanel: string[];
  footer: string[];
}

const PANEL_NUMBER: Record<TuiPanelId, string> = {
  summary: "1",
  timeline: "2",
  flow: "3",
  signals: "4",
  evidence: "5",
  "ai-analysis": "6",
  reports: "7",
  diagnostics: "8",
};

function sectionHeader(title: string): string {
  return `-- ${title} --`;
}

function padOrTrim(lines: string[], maxLines: number): string[] {
  if (lines.length >= maxLines) return lines.slice(0, maxLines);
  return [...lines, ...Array.from({ length: maxLines - lines.length }, () => "")];
}

export function renderLayout(result: AnalysisResult, state: TuiState, isLive: boolean, liveStatus: string): LayoutRender {
  const spec = PANEL_SPECS[state.activePanel];
  const services = result.summary.affectedServices.slice(0, 3).join(", ") || "unknown";
  const warnings = result.diagnostics.warnings.length;
  const liveTag = isLive ? `LIVE:${liveStatus}` : "BATCH";

  const topStrip = [
    `SOLID Incident Console   ${liveTag}   Panel ${PANEL_NUMBER[state.activePanel]} ${spec.title}`,
    `Trigger: ${result.summary.triggerEvent || "n/a"} | Confidence: ${result.summary.confidence}% | Services: ${services}`,
    `Window: ${result.summary.incidentWindow.start} -> ${result.summary.incidentWindow.end} | Warnings: ${warnings} | Focus: ${state.focusRegion ?? "main"}`,
  ];

  const main = [sectionHeader(spec.title), ...spec.main(result, state.filter, state.searchQuery)];
  const side = [sectionHeader("Context"), ...spec.side(result, state.filter, state.searchQuery)];

  const footer = [
    "1-8 panels  tab focus  / search  f filter  t trigger  s strongest  g AI refresh  r/c/i reports  e export  w save  x clear  ? help  q quit",
    state.message ? `Status: ${state.message}` : "Status: Ready",
  ];

  return {
    topStrip: padOrTrim(topStrip, 3),
    mainPanel: padOrTrim(main, 28),
    sidePanel: padOrTrim(side, 28),
    footer: padOrTrim(footer, 2),
  };
}

