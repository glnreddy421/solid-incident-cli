import type { AnalysisResult } from "../../contracts/index.js";
import { stateFooterNote } from "../state/analysisState.js";
import type { TemplateContext } from "../types.js";
import { formatCandidateConfidence } from "../utils/formatConfidence.js";
import { signalsLines, topologyLines } from "../engineExtract.js";
import { formatEvidenceBullets } from "../utils/formatEvidenceList.js";

export function buildDebugSections(result: AnalysisResult, ctx: TemplateContext): Record<string, string> {
  const a = result.assessment;
  const st = ctx.state;
  const sections: Record<string, string> = {};

  sections.observations = [
    `**Events in window:** ${result.timeline.length}`,
    `**Signals:** ${result.signals.length}`,
    `**Verdict:** ${a.verdict} / ${a.severity}`,
    `**Parse coverage:** ${result.diagnostics.parseCoverage != null ? `${Math.round((result.diagnostics.parseCoverage ?? 0) * 100)}%` : "—"}`,
  ].join("\n");

  const hypo = a.rootCauseCandidates?.slice(0, 6) ?? [];
  sections.hypotheses = hypo.length
    ? hypo.map((c, i) => `${i + 1}. **${c.label ?? c.id}** ${formatCandidateConfidence(c.confidence)} — ${c.evidence}`).join("\n")
    : "—";

  sections.structure = [
    "**Topology (edges):**",
    formatEvidenceBullets(topologyLines(result)),
    "",
    "**Signals:**",
    formatEvidenceBullets(signalsLines(result)),
  ].join("\n");

  if (ctx.includeTrustNotes) {
    sections.trust = [
      result.diagnostics.ambiguityFlags?.length
        ? `**Ambiguity:** ${result.diagnostics.ambiguityFlags.join("; ")}`
        : "",
      result.diagnostics.mlNotes ? `**ML notes:** ${result.diagnostics.mlNotes}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const foot = stateFooterNote(st);
  if (foot) sections.footer = foot;

  return sections;
}
