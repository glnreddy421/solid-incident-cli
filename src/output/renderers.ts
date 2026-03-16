import type { AnalysisResult, AppMode, SolidError } from "../contracts/index.js";

export function renderText(result: AnalysisResult): string {
  const lines: string[] = [];
  lines.push("SOLID INCIDENT ANALYSIS");
  lines.push("=======================");
  lines.push(`Verdict: ${result.assessment.verdict}`);
  lines.push(`Severity: ${result.assessment.severity}`);
  lines.push(`Health score: ${result.assessment.healthScore}/100`);
  lines.push(`Reason: ${result.assessment.verdictReason}`);
  lines.push(`Summary: ${result.ai.available ? (result.ai.summary ?? result.summary.incidentSummary) : result.summary.incidentSummary}`);
  lines.push(`Trigger: ${result.summary.triggerEvent}`);
  lines.push(`Confidence: ${result.summary.confidence}%`);
  lines.push(`Services: ${result.summary.affectedServices.join(", ") || "unknown"}`);
  lines.push(`Window: ${result.summary.incidentWindow.start} -> ${result.summary.incidentWindow.end}`);
  lines.push(
    `Event distribution: info ${result.assessment.eventDistribution.info} | warn ${result.assessment.eventDistribution.warn} | error ${result.assessment.eventDistribution.error} | anomaly ${result.assessment.eventDistribution.anomaly}`
  );
  lines.push("");
  lines.push("Timeline");
  lines.push("--------");
  for (const entry of result.timeline.slice(0, 30)) {
    lines.push(`${entry.timestamp} [${entry.severity}] ${entry.service}: ${entry.message}`);
  }
  lines.push("");
  lines.push("Signals");
  lines.push("-------");
  for (const signal of result.signals) {
    const scoreTag = signal.mlScore != null
  ? ` | ${(signal as { scoreSource?: string }).scoreSource === "tfidf" ? "tfidf" : "ml"}:${Math.round(signal.mlScore * 100)}`
  : "";
lines.push(`- [${signal.severity}] ${signal.label} | score ${signal.score ?? signal.count ?? 1}${scoreTag}${signal.description ? ` | ${signal.description}` : ""}`);
  }
  const a = result.assessment;
  const ai = result.ai;
  const useAi = ai.available;
  const causes = useAi ? ai.rootCauseCandidates : (a.suggestedCauses ?? []);
  const fixes = useAi ? ai.recommendedChecks : (a.suggestedFixes ?? []);

  lines.push("");
  lines.push("Root Cause Candidates");
  lines.push("---------------------");
  if (useAi && ai.rootCauseCandidates.length) {
    for (const c of ai.rootCauseCandidates) lines.push(`- ${c}`);
  } else if (!useAi && a.rootCauseCandidates.length) {
    for (const rc of a.rootCauseCandidates.slice(0, 3)) {
      lines.push(`- ${rc.id} (confidence ${Math.round(rc.confidence * 100)}%, evidence: ${rc.evidence})`);
    }
  } else {
    lines.push("- No dominant root cause pattern identified.");
  }
  if (useAi ? ai.summary : a.humanExplanation) {
    lines.push("");
    lines.push("Explanation");
    lines.push("-----------");
    lines.push(useAi ? (ai.summary ?? "") : a.humanExplanation!);
  }
  if (causes.length) {
    lines.push("");
    lines.push("Suggested causes");
    lines.push("----------------");
    for (const c of causes) lines.push(`  • ${c}`);
  }
  if (fixes.length) {
    lines.push("");
    lines.push("Suggested fixes");
    lines.push("---------------");
    for (const f of fixes) lines.push(`  • ${f}`);
  }
  if (!useAi) {
    lines.push("");
    lines.push("AI Analysis");
    lines.push("-----------");
    lines.push(ai.warning ?? "AI unavailable.");
  }
  return lines.join("\n");
}

export function renderJson(result: AnalysisResult): string {
  return JSON.stringify(result, null, 2);
}

export function renderMarkdown(result: AnalysisResult): string {
  const lines: string[] = [];
  const useAiMd = result.ai.available;
  lines.push("# SOLID Incident Report");
  lines.push("");
  lines.push("## Summary");
  lines.push(useAiMd ? (result.ai.summary ?? result.summary.incidentSummary) : result.summary.incidentSummary);
  lines.push("");
  lines.push(`- Trigger: ${result.summary.triggerEvent}`);
  lines.push(`- Confidence: ${result.summary.confidence}%`);
  lines.push(`- Services: ${result.summary.affectedServices.join(", ") || "unknown"}`);
  lines.push(`- Incident window: ${result.summary.incidentWindow.start} -> ${result.summary.incidentWindow.end}`);
  lines.push("");
  lines.push("## Timeline");
  for (const entry of result.timeline) {
    lines.push(`- **${entry.timestamp}** \`${entry.service}\` [${entry.severity}] ${entry.message}`);
  }
  lines.push("");
  lines.push("## Trace");
  const traceEdges = result.traceGraph?.edges?.length ? result.traceGraph.edges : result.flow.map((e) => ({ from: e.from, to: e.to, annotation: "impact" as const, count: e.count, confidence: e.confidence }));
  for (const edge of traceEdges) {
    lines.push(`- ${edge.from} → ${edge.to} [${edge.annotation}] (${edge.count} events, ${Math.round(edge.confidence * 100)}%)`);
  }
  lines.push("");
  const a = result.assessment;
  const aiMd = result.ai;
  const causesMd = useAiMd ? aiMd.rootCauseCandidates : (a.suggestedCauses ?? []);
  const fixesMd = useAiMd ? aiMd.recommendedChecks : (a.suggestedFixes ?? []);
  const explanationMd = useAiMd ? aiMd.summary : a.humanExplanation;
  if (explanationMd) {
    lines.push("## Explanation");
    lines.push(explanationMd);
    lines.push("");
  }
  if (causesMd.length) {
    lines.push("## Suggested causes");
    for (const c of causesMd) lines.push(`- ${c}`);
    lines.push("");
  }
  if (fixesMd.length) {
    lines.push("## Suggested fixes");
    for (const f of fixesMd) lines.push(`- ${f}`);
    lines.push("");
  }
  if (!useAiMd) {
    lines.push("## AI Analysis");
    lines.push(aiMd.warning ?? "AI unavailable.");
  }
  return lines.join("\n");
}

export function renderHtml(result: AnalysisResult): string {
  const esc = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>SOLID Incident Report</title></head>
<body>
  <h1>SOLID Incident Report</h1>
  <h2>Summary</h2>
  <p>${esc(result.summary.incidentSummary)}</p>
  <ul>
    <li>Trigger: ${esc(result.summary.triggerEvent)}</li>
    <li>Confidence: ${result.summary.confidence}%</li>
    <li>Services: ${esc(result.summary.affectedServices.join(", "))}</li>
  </ul>
  <h2>Timeline</h2>
  <ul>
    ${result.timeline.map((e) => `<li>${esc(e.timestamp)} [${esc(e.severity)}] ${esc(e.service)}: ${esc(e.message)}</li>`).join("\n")}
  </ul>
</body>
</html>`;
}

export function renderError(error: unknown, verbose = false): string {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    const e = error as SolidError;
    return verbose && e.options.details ? `[${e.code}] ${e.message}\n${e.options.details}` : `[${e.code}] ${e.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export function renderByMode(result: AnalysisResult, mode: Exclude<AppMode, "tui">): string {
  if (mode === "json") return renderJson(result);
  if (mode === "markdown") return renderMarkdown(result);
  if (mode === "html") return renderHtml(result);
  return renderText(result);
}

