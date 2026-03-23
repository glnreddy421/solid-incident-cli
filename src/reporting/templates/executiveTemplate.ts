import type { AnalysisResult } from "../../contracts/index.js";
import { stateFooterNote } from "../state/analysisState.js";
import type { TemplateContext } from "../types.js";
import { formatCandidateConfidence } from "../utils/formatConfidence.js";
import { formatServiceList } from "../utils/formatServiceList.js";

export function buildExecutiveSections(result: AnalysisResult, ctx: TemplateContext): Record<string, string> {
  const a = result.assessment;
  const s = result.summary;
  const st = ctx.state;
  const sections: Record<string, string> = {};

  const lead =
    st === "final"
      ? "**Executive summary**"
      : "**Executive snapshot (non-final)**";

  sections.summary = [
    lead,
    "",
    `- **What happened:** ${a.summaryNarrative || s.incidentSummary || "—"}`,
    `- **Verdict:** ${a.verdict} (${a.severity})`,
    `- **Services:** ${formatServiceList(s.affectedServices) || "—"}`,
    `- **Trigger:** ${s.triggerEvent}`,
    a.rootCauseCandidates?.[0]
      ? `- **Likely cause (engine):** ${a.rootCauseCandidates[0].label ?? a.rootCauseCandidates[0].id} (${formatCandidateConfidence(a.rootCauseCandidates[0].confidence)})`
      : `- **Root cause:** not conclusively ranked`,
    ctx.includeConfidence ? `- **Confidence:** ${s.confidence}%` : "",
  ]
    .filter(Boolean)
    .join("\n");

  if (ctx.includeSuggestedFixes && a.recommendedActions?.length) {
    sections.immediateActions = a.recommendedActions.slice(0, 6).map((x, i) => `${i + 1}. ${x}`).join("\n");
  }

  const foot = stateFooterNote(st);
  if (foot) sections.footer = foot;

  return sections;
}
