import type { AnalysisResult } from "../contracts/index.js";
import { resolveReportState, stateBannerTitle } from "./state/analysisState.js";
import type { RenderReportOptions, RenderedReport, ReportStyle, TemplateContext } from "./types.js";
import { polishReportMarkdown } from "./nlp/cleanupText.js";
import { buildRcaSections } from "./templates/rcaTemplate.js";
import { buildStarSections } from "./templates/starTemplate.js";
import { buildCarSections } from "./templates/carTemplate.js";
import { buildExecutiveSections } from "./templates/executiveTemplate.js";
import { buildDebugSections } from "./templates/debugTemplate.js";
import { buildTimelineSections } from "./templates/timelineTemplate.js";

const STYLE_TITLES: Record<ReportStyle, string> = {
  rca: "Root cause analysis",
  star: "STAR narrative",
  car: "CAR narrative",
  executive: "Executive summary",
  debug: "Debug summary",
  timeline: "Timeline narrative",
};

/** Ordered [sectionKey, heading] for markdown assembly */
const RCA_HEADINGS: [string, string][] = [
  ["incidentSummary", "Incident summary"],
  ["triggerEvent", "Trigger event"],
  ["likelyRootCause", "Likely root cause"],
  ["failurePropagation", "Failure propagation"],
  ["affectedServices", "Affected services"],
  ["timelineEvidence", "Evidence timeline"],
  ["evidenceAndSignals", "Evidence and signals"],
  ["confidenceNotes", "Confidence"],
  ["trustNotes", "Trust notes"],
  ["suggestedNextSteps", "Suggested next checks and fixes"],
  ["footer", "—"],
];

const STAR_HEADINGS: [string, string][] = [
  ["situation", "Situation"],
  ["task", "Task"],
  ["action", "Action"],
  ["result", "Result"],
  ["footer", "—"],
];

const CAR_HEADINGS: [string, string][] = [
  ["context", "Context"],
  ["action", "Action"],
  ["result", "Result"],
  ["footer", "—"],
];

const EXEC_HEADINGS: [string, string][] = [
  ["summary", "Summary"],
  ["immediateActions", "Immediate actions"],
  ["footer", "—"],
];

const DEBUG_HEADINGS: [string, string][] = [
  ["observations", "Observations"],
  ["hypotheses", "Working hypotheses"],
  ["structure", "Topology and signals"],
  ["trust", "Trust / diagnostics"],
  ["footer", "—"],
];

const TIMELINE_HEADINGS: [string, string][] = [
  ["narrative", "Narrative"],
  ["footer", "—"],
];

function assembleMarkdown(
  style: ReportStyle,
  state: import("./types.js").ReportState,
  sections: Record<string, string>,
  order: [string, string][],
): string {
  const parts: string[] = [];
  const titleBase = STYLE_TITLES[style];
  const stateSuffix = state === "final" ? "" : ` (${state})`;
  parts.push(`# ${titleBase}${stateSuffix}`);
  parts.push("");
  parts.push(
    "> **Deterministic report:** formatted from the local heuristic engine only. **No LLM** — conclusions are unchanged from analysis output.",
  );
  parts.push("");

  const banner = stateBannerTitle(state);
  if (banner) {
    parts.push(`## ${banner}`);
    parts.push("");
    parts.push(
      state === "live"
        ? "_Rolling or tailing analysis — this is not a closed postmortem._"
        : state === "snapshot"
          ? "_Single log window or one-off slice — conclusions may change with more data._"
          : "_Evidence is limited — treat all conclusions as tentative._",
    );
    parts.push("");
  }

  for (const [key, heading] of order) {
    const body = sections[key];
    if (!body?.trim()) continue;
    if (heading === "—") {
      parts.push(body);
    } else {
      parts.push(`## ${heading}`);
      parts.push("");
      parts.push(body.trim());
    }
    parts.push("");
  }

  return parts.join("\n").trim() + "\n";
}

function buildSectionsForStyle(
  style: ReportStyle,
  result: AnalysisResult,
  ctx: TemplateContext,
): Record<string, string> {
  switch (style) {
    case "rca":
      return buildRcaSections(result, ctx);
    case "star":
      return buildStarSections(result, ctx);
    case "car":
      return buildCarSections(result, ctx);
    case "executive":
      return buildExecutiveSections(result, ctx);
    case "debug":
      return buildDebugSections(result, ctx);
    case "timeline":
      return buildTimelineSections(result, ctx);
  }
}

function headingsForStyle(style: ReportStyle): [string, string][] {
  switch (style) {
    case "rca":
      return RCA_HEADINGS;
    case "star":
      return STAR_HEADINGS;
    case "car":
      return CAR_HEADINGS;
    case "executive":
      return EXEC_HEADINGS;
    case "debug":
      return DEBUG_HEADINGS;
    case "timeline":
      return TIMELINE_HEADINGS;
  }
}

/**
 * Deterministic report: template + optional rule-based polish. Does not alter engine conclusions.
 */
export function renderReport(result: AnalysisResult, options: RenderReportOptions): RenderedReport {
  const state = resolveReportState(result, options.state);
  const ctx: TemplateContext = {
    state,
    includeConfidence: options.includeConfidence !== false,
    includeTrustNotes: options.includeTrustNotes !== false,
    includeSuggestedFixes: options.includeSuggestedFixes !== false,
  };

  const rawSections = buildSectionsForStyle(options.style, result, ctx);
  const assembled = assembleMarkdown(options.style, state, rawSections, headingsForStyle(options.style));
  const polished = options.polish !== false ? polishReportMarkdown(assembled) : assembled;

  return {
    style: options.style,
    state,
    title: `${STYLE_TITLES[options.style]}${state === "final" ? "" : ` (${state})`}`,
    rawSections,
    finalText: polished,
    metadata: {
      polished: options.polish !== false,
      generatedAt: new Date().toISOString(),
    },
  };
}

/** Map legacy heuristic kinds to report styles */
export function heuristicKindToStyle(kind: "rca" | "interview"): "rca" | "star" {
  return kind === "rca" ? "rca" : "star";
}
