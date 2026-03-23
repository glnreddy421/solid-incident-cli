import type { AnalysisResult } from "../../contracts/index.js";
import { stateFooterNote } from "../state/analysisState.js";
import type { TemplateContext } from "../types.js";
import { formatCandidateConfidence } from "../utils/formatConfidence.js";
import { formatServiceList } from "../utils/formatServiceList.js";
import { topologyLines } from "../engineExtract.js";
import { formatEvidenceBullets } from "../utils/formatEvidenceList.js";

export function buildCarSections(result: AnalysisResult, ctx: TemplateContext): Record<string, string> {
  const a = result.assessment;
  const s = result.summary;
  const st = ctx.state;
  const sections: Record<string, string> = {};

  const ctxIntro =
    st === "final"
      ? "**Context:**"
      : "**Context (current log window):**";

  sections.context = [
    ctxIntro,
    `${a.verdict} / ${a.severity} affecting **${formatServiceList(s.affectedServices) || "services"}**.`,
    `**Trigger:** ${a.triggerService} — ${a.triggerEvent}.`,
    `**Why it matters:** ${a.verdictReason}`,
    `**Summary:** ${a.summaryNarrative || s.incidentSummary || "—"}`,
  ].join("\n");

  const topo = topologyLines(result);
  const top = a.rootCauseCandidates?.[0];
  sections.action = [
    "**Actions implied by engine structure:**",
    formatEvidenceBullets(topo.slice(0, 10)),
    top
      ? `\n**Focus hypothesis:** **${top.label ?? top.id}** (${formatCandidateConfidence(top.confidence)}) — ${top.evidence}`
      : "",
    ctx.includeSuggestedFixes && a.recommendedActions?.length
      ? `\n**Checks:**\n${a.recommendedActions.slice(0, 8).map((x, i) => `${i + 1}. ${x}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  sections.result =
    st === "final"
      ? `**Result:** Characterized with health ${a.healthScore}/100 and ${s.confidence}% summary confidence. Confirm with traces and change records.`
      : `**Observed result so far:** Health ${a.healthScore}/100 and ${s.confidence}% summary confidence in this window — subject to change.`;

  const foot = stateFooterNote(st);
  if (foot) sections.footer = foot;

  return sections;
}
