import type { AnalysisResult } from "../../contracts/index.js";
import {
  affectedPhrase,
  propagationPhrase,
  rootCausePhrase,
  stateFooterNote,
  triggerPhrase,
} from "../state/analysisState.js";
import type { ReportState, TemplateContext } from "../types.js";
import { chronologicalTimelineLines, signalsLines, tbl, topologyLines, topSeverityTimelineLines } from "../engineExtract.js";
import { formatEvidenceBullets } from "../utils/formatEvidenceList.js";
import { formatServiceList } from "../utils/formatServiceList.js";
import { formatCandidateConfidence, formatSummaryConfidenceLine } from "../utils/formatConfidence.js";

function confidenceBandStatement(state: ReportState, conf: number): string {
  if (state === "partial" || conf < 45) return "This assessment is tentative.";
  if (conf < 72) return "This assessment is moderately supported by the available evidence.";
  return "This assessment is strongly supported by the available evidence.";
}

export function buildRcaSections(result: AnalysisResult, ctx: TemplateContext): Record<string, string> {
  const a = result.assessment;
  const s = result.summary;
  const st = ctx.state;
  const sections: Record<string, string> = {};

  const summaryNarrative = a.summaryNarrative || s.incidentSummary || "—";
  const services = formatServiceList(s.affectedServices);
  const top = a.rootCauseCandidates?.[0];
  const trig = `${triggerPhrase(st)} **${a.triggerService}** (${a.triggerEvent}).`;

  sections.incidentSummary = [
    `**Verdict:** ${a.verdict} · **Severity:** ${a.severity} · **Health score:** ${a.healthScore}/100.`,
    `**Impact (engine):** ${a.verdictReason}`,
    `**Window:** ${s.incidentWindow.start} → ${s.incidentWindow.end}.`,
    `**Narrative:** ${summaryNarrative}`,
  ].join("\n");

  sections.triggerEvent = [
    trig,
    `**Classification:** ${a.triggerClassification} · **Impact class:** ${a.triggerImpact}.`,
    `**When:** ${a.triggerTimestamp}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Service | ${tbl(a.triggerService)} |`,
    `| Event | ${tbl(a.triggerEvent)} |`,
    `| PID / host | ${tbl(String(a.triggerPid ?? "—"))} / ${tbl(a.triggerHost ?? "—")} |`,
  ].join("\n");

  if (top) {
    sections.likelyRootCause = [
      `${rootCausePhrase(st)} **${top.label ?? top.id}** (engine confidence ${formatCandidateConfidence(top.confidence)}).`,
      `**Evidence:** ${top.evidence}`,
      top.scoreBreakdown
        ? `**Score blend:** heuristic ${formatCandidateConfidence(top.scoreBreakdown.heuristicScore)} · topology ${formatCandidateConfidence(top.scoreBreakdown.topologyScore)} · temporal ${formatCandidateConfidence(top.scoreBreakdown.temporalScore)} · severity ${formatCandidateConfidence(top.scoreBreakdown.severityScore)} · ML ${formatCandidateConfidence(top.scoreBreakdown.mlAnomalyScore)}.`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  } else {
    sections.likelyRootCause =
      st === "final"
        ? "No dominant ranked hypothesis — use trigger and propagation to prioritize investigation."
        : "No dominant hypothesis yet in this window — more events may clarify ranking.";
  }

  const topo = topologyLines(result);
  sections.failurePropagation = [
    `${propagationPhrase(st)} the following edges (ordered by engine strength):`,
    "",
    formatEvidenceBullets(topo),
    a.propagationChain?.length
      ? `\n**Chain (engine):**\n${formatEvidenceBullets(a.propagationChain.slice(0, 18))}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  sections.affectedServices = `${affectedPhrase(st)}: **${services}**.`;

  const sig = signalsLines(result);
  sections.evidenceAndSignals = formatEvidenceBullets(sig);

  if (ctx.includeConfidence) {
    sections.confidenceNotes = [
      formatSummaryConfidenceLine(s.confidence, st),
      confidenceBandStatement(st, s.confidence ?? 0),
    ].join("\n");
  }

  if (ctx.includeTrustNotes && (a.systemHealthSummary?.length || result.diagnostics.ambiguityFlags?.length)) {
    const health = a.systemHealthSummary?.slice(0, 6).join("; ") || "";
    const amb = result.diagnostics.ambiguityFlags?.slice(0, 6).join("; ") || "";
    sections.trustNotes = [health && `**Health notes:** ${health}`, amb && `**Ambiguity flags:** ${amb}`]
      .filter(Boolean)
      .join("\n\n");
  }

  if (ctx.includeSuggestedFixes) {
    const actions = a.recommendedActions ?? [];
    const fixes = a.suggestedFixes ?? [];
    const lines: string[] = [];
    if (actions.length) lines.push(...actions.slice(0, 12).map((x, i) => `${i + 1}. ${x}`));
    if (fixes.length) lines.push(...fixes.slice(0, 8).map((x) => `- ${x}`));
    sections.suggestedNextSteps = lines.length ? lines.join("\n") : "—";
  }

  const chrono = chronologicalTimelineLines(result);
  const sev = topSeverityTimelineLines(result);
  sections.timelineEvidence = [
    "**Chronological (ordered):**",
    formatEvidenceBullets(chrono),
    result.timeline.length > 16 ? `\n*…${result.timeline.length - 16} more events in engine.*` : "",
    "",
    "**Highest-severity excerpts:**",
    formatEvidenceBullets(sev),
  ]
    .filter(Boolean)
    .join("\n");

  const foot = stateFooterNote(st);
  if (foot) sections.footer = foot;

  return sections;
}
