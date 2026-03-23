import type { AnalysisResult } from "../../contracts/index.js";
import { stateFooterNote } from "../state/analysisState.js";
import type { TemplateContext } from "../types.js";
import { formatCandidateConfidence } from "../utils/formatConfidence.js";
import { formatServiceList } from "../utils/formatServiceList.js";

export function buildStarSections(result: AnalysisResult, ctx: TemplateContext): Record<string, string> {
  const a = result.assessment;
  const s = result.summary;
  const st = ctx.state;
  const sections: Record<string, string> = {};

  const tense =
    st === "final"
      ? "Monitoring and log analysis showed"
      : "So far, monitoring and log analysis in this window shows";

  sections.situation = [
    `${tense} **${a.verdict}** (${a.severity}) across **${formatServiceList(s.affectedServices) || "the estate"}** during **${s.incidentWindow.start}–${s.incidentWindow.end}**.`,
    `**Triggering signal:** **${a.triggerService}** — ${a.triggerEvent} (${a.triggerClassification}, impact ${a.triggerImpact}).`,
    `**Summary:** ${a.summaryNarrative || s.incidentSummary || "—"}`,
    `**Context:** ${a.verdictReason}`,
  ].join("\n");

  sections.task =
    a.verdict === "INCIDENT DETECTED"
      ? "Stabilize impact, preserve evidence, isolate the failing dependency or path, and restore service while limiting recurrence."
      : a.verdict === "POSSIBLE DEGRADATION"
        ? "Confirm SLO impact, narrow blast radius, and choose rollback, scale-out, or feature flags with clear stakeholder comms."
        : "Determine whether this is normal variance or a nascent incident; document exit criteria.";

  const chain = a.propagationChain?.slice(0, 12) ?? [];
  const causes = a.rootCauseCandidates?.slice(0, 4) ?? [];
  const act: string[] = [];
  if (chain.length) {
    act.push("**Propagation mapped (engine):**");
    chain.forEach((c) => act.push(`- ${c}`));
  }
  if (causes.length) {
    act.push("**Hypotheses prioritized (engine):**");
    causes.forEach((c) => act.push(`- **${c.label ?? c.id}** (${formatCandidateConfidence(c.confidence)}): ${c.evidence}`));
  }
  if (ctx.includeSuggestedFixes && a.recommendedActions?.length) {
    act.push("**Recommended checks (engine):**");
    a.recommendedActions.slice(0, 8).forEach((x, i) => act.push(`${i + 1}. ${x}`));
  }
  sections.action = act.length ? act.join("\n") : "Review trace graph and signals in the structured export for next steps.";

  const resultIntro =
    st === "final"
      ? "**Observed outcome (from engine characterization):**"
      : "**Current observed result (may evolve if the stream continues):**";
  sections.result = [
    resultIntro,
    `Health score **${a.healthScore}/100**; summary confidence **${s.confidence}%**.`,
    causes[0]
      ? `Leading hypothesis: **${causes[0].label ?? causes[0].id}** (${formatCandidateConfidence(causes[0].confidence)}).`
      : "",
    st === "final"
      ? "Remediation completeness is not inferred — validate in production controls."
      : "This is not a statement that remediation finished; it reflects the current log-derived view only.",
  ]
    .filter(Boolean)
    .join("\n");

  const foot = stateFooterNote(st);
  if (foot) sections.footer = foot;

  return sections;
}
