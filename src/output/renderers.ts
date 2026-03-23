import type { AnalysisResult, AppMode, SolidError } from "../contracts/index.js";
import {
  aiHasUsableContent,
  aiOrEngineTimelineNarrative,
  aiPrimaryHeadline,
  displayRecommendedLines,
  displayRootCauseLines,
} from "../utils/enrich/aiPresentation.js";

export function renderText(result: AnalysisResult): string {
  const lines: string[] = [];
  lines.push("SOLID INCIDENT ANALYSIS");
  lines.push("=======================");
  lines.push(`Verdict: ${result.assessment.verdict}`);
  lines.push(`Severity: ${result.assessment.severity}`);
  lines.push(`Health score: ${result.assessment.healthScore}/100`);
  lines.push(`Reason: ${result.assessment.verdictReason}`);
  const preferAiSummary = aiHasUsableContent(result.ai);
  const headline = preferAiSummary
    ? aiPrimaryHeadline(result.ai) || result.ai.summary || result.summary.incidentSummary
    : result.summary.incidentSummary;
  lines.push(`Summary: ${headline}`);
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
  const preferAi = aiHasUsableContent(ai);
  const engineCauses = a.suggestedCauses ?? [];
  const engineFixes = a.suggestedFixes ?? [];

  lines.push("");
  lines.push("Root Cause Candidates");
  lines.push("---------------------");
  if (preferAi) {
    for (const block of displayRootCauseLines(ai, a.rootCauseCandidates)) {
      const parts = block.split("\n");
      lines.push(`- ${parts[0]}`);
      for (let i = 1; i < parts.length; i++) lines.push(`  ${parts[i]}`);
    }
  } else if (a.rootCauseCandidates.length) {
    for (const rc of a.rootCauseCandidates.slice(0, 3)) {
      lines.push(`- ${rc.id} (confidence ${Math.round(rc.confidence * 100)}%, evidence: ${rc.evidence})`);
    }
  } else {
    lines.push("- No dominant root cause pattern identified.");
  }
  if (preferAi) {
    lines.push("");
    lines.push("AI narrative");
    lines.push("------------");
    if (ai.operatorNarrative?.trim()) lines.push(ai.operatorNarrative.trim());
    lines.push(aiOrEngineTimelineNarrative(ai, a.summaryNarrative || ""));
    if (ai.confidenceStatement?.trim()) {
      lines.push("");
      lines.push(`Confidence: ${ai.confidenceStatement.trim()}`);
    }
    if (ai.caveats?.length) {
      lines.push("");
      lines.push("Caveats:");
      for (const c of ai.caveats.slice(0, 6)) lines.push(`  • ${c}`);
    }
  } else if (a.humanExplanation) {
    lines.push("");
    lines.push("Explanation");
    lines.push("-----------");
    lines.push(a.humanExplanation);
  }
  if (!preferAi && engineCauses.length) {
    lines.push("");
    lines.push("Suggested causes");
    lines.push("----------------");
    for (const c of engineCauses) lines.push(`  • ${c}`);
  }
  if (preferAi) {
    const recBlocks = displayRecommendedLines(ai, a.recommendedActions);
    const onlyPlaceholder = recBlocks.length === 1 && recBlocks[0] === "No specific checks suggested.";
    if (!onlyPlaceholder) {
      lines.push("");
      lines.push("Recommended checks (AI)");
      lines.push("----------------------");
      for (const block of recBlocks) {
        const parts = block.split("\n");
        lines.push(`  • ${parts[0]}`);
        for (let i = 1; i < parts.length; i++) lines.push(`    ${parts[i]}`);
      }
    }
  } else if (engineFixes.length) {
    lines.push("");
    lines.push("Suggested fixes");
    lines.push("---------------");
    for (const f of engineFixes) lines.push(`  • ${f}`);
  }
  if (!ai.available) {
    lines.push("");
    lines.push("AI interpretation");
    lines.push("-----------");
    lines.push(ai.warning ?? "AI unavailable.");
  } else if (!preferAi) {
    lines.push("");
    lines.push("AI interpretation");
    lines.push("-----------");
    lines.push(ai.warning || "AI connected but returned sparse enrichment; engine fields above are authoritative.");
  }
  const followUps = result.ai.followUpArtifacts ?? [];
  if (followUps.length) {
    lines.push("");
    lines.push("BYO follow-up outputs (explicit passes)");
    lines.push("--------------------------------------");
    for (const art of followUps) {
      lines.push(`[${art.style}] generated ${art.generatedAt}`);
      const body = art.content.trim();
      if (body) {
        for (const ln of body.split("\n")) lines.push(`  ${ln}`);
      }
      lines.push("");
    }
  }
  const hr = result.heuristicReports;
  if (hr?.rca?.markdown) {
    lines.push("");
    lines.push(`Engine RCA (explicit, ${hr.rca.generatedAt})`);
    lines.push("-------------------------");
    lines.push(hr.rca.markdown);
  }
  if (hr?.interview?.markdown) {
    lines.push("");
    lines.push(`Engine interview STAR (explicit, ${hr.interview.generatedAt})`);
    lines.push("------------------------------------------");
    lines.push(hr.interview.markdown);
  }
  return lines.join("\n");
}

export function renderJson(result: AnalysisResult): string {
  return JSON.stringify(result, null, 2);
}

export function renderMarkdown(result: AnalysisResult): string {
  const lines: string[] = [];
  const a = result.assessment;
  const aiMd = result.ai;
  const preferMd = aiHasUsableContent(aiMd);
  lines.push("# SOLID Incident Report");
  lines.push("");
  lines.push("## Summary");
  lines.push(
    preferMd
      ? aiPrimaryHeadline(aiMd) || aiMd.summary || result.summary.incidentSummary
      : result.summary.incidentSummary,
  );
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
  if (preferMd) {
    lines.push("## AI enrichment");
    if (aiMd.operatorNarrative?.trim()) {
      lines.push("### Operator narrative");
      lines.push(aiMd.operatorNarrative.trim());
      lines.push("");
    }
    lines.push("### Timeline narrative");
    lines.push(aiOrEngineTimelineNarrative(aiMd, a.summaryNarrative || ""));
    lines.push("");
    if (aiMd.confidenceStatement?.trim()) {
      lines.push(`**Confidence:** ${aiMd.confidenceStatement.trim()}`);
      lines.push("");
    }
    lines.push("### Root-cause hypotheses");
    for (const block of displayRootCauseLines(aiMd, a.rootCauseCandidates)) {
      lines.push("```");
      lines.push(block);
      lines.push("```");
      lines.push("");
    }
    const recMd = displayRecommendedLines(aiMd, a.recommendedActions);
    const onlyPh = recMd.length === 1 && recMd[0] === "No specific checks suggested.";
    if (!onlyPh) {
      lines.push("### Recommended checks");
      for (const block of recMd) {
        for (const ln of block.split("\n")) lines.push(`- ${ln}`);
        lines.push("");
      }
    }
    if (aiMd.followUpQuestions?.length) {
      lines.push("### Follow-up questions");
      for (const q of aiMd.followUpQuestions) lines.push(`- ${q}`);
      lines.push("");
    }
    if (aiMd.caveats?.length) {
      lines.push("### Caveats");
      for (const c of aiMd.caveats) lines.push(`- ${c}`);
      lines.push("");
    }
  } else {
    if (a.humanExplanation) {
      lines.push("## Explanation");
      lines.push(a.humanExplanation);
      lines.push("");
    }
    if ((a.suggestedCauses ?? []).length) {
      lines.push("## Suggested causes");
      for (const c of a.suggestedCauses ?? []) lines.push(`- ${c}`);
      lines.push("");
    }
    if ((a.suggestedFixes ?? []).length) {
      lines.push("## Suggested fixes");
      for (const f of a.suggestedFixes ?? []) lines.push(`- ${f}`);
      lines.push("");
    }
  }
  if (!aiMd.available) {
    lines.push("## AI status");
    lines.push(aiMd.warning ?? "AI unavailable.");
  } else if (!preferMd) {
    lines.push("## AI status");
    lines.push(aiMd.warning || "Connected; enrichment was sparse — prefer engine sections above.");
  }
  const followUpsMd = result.ai.followUpArtifacts ?? [];
  if (followUpsMd.length) {
    lines.push("## BYO follow-up outputs");
    lines.push("");
    lines.push(
      "Additional LLM passes after primary enrichment (CLI `--follow-up` or TUI `n` + digit). Each block is anchored on the primary narrative plus structured facts.",
    );
    lines.push("");
    for (const art of followUpsMd) {
      lines.push(`### ${art.style}`);
      lines.push("");
      lines.push(`*Generated: ${art.generatedAt}*`);
      lines.push("");
      lines.push(art.content.trim() || "_empty_");
      lines.push("");
    }
  }
  const hrMd = result.heuristicReports;
  if (hrMd?.rca?.markdown) {
    lines.push("## Engine RCA (explicit request)");
    lines.push("");
    lines.push(`*${hrMd.rca.generatedAt}*`);
    lines.push("");
    lines.push(hrMd.rca.markdown);
    lines.push("");
  }
  if (hrMd?.interview?.markdown) {
    lines.push("## Engine interview — STAR (explicit request)");
    lines.push("");
    lines.push(`*${hrMd.interview.generatedAt}*`);
    lines.push("");
    lines.push(hrMd.interview.markdown);
    lines.push("");
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

