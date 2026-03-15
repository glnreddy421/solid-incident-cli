import type { AnalysisResult, AppMode, SolidError } from "../contracts/index.js";

export function renderText(result: AnalysisResult): string {
  const lines: string[] = [];
  lines.push("SOLID INCIDENT ANALYSIS");
  lines.push("=======================");
  lines.push(`Summary: ${result.summary.incidentSummary}`);
  lines.push(`Trigger: ${result.summary.triggerEvent}`);
  lines.push(`Confidence: ${result.summary.confidence}%`);
  lines.push(`Services: ${result.summary.affectedServices.join(", ") || "unknown"}`);
  lines.push(`Window: ${result.summary.incidentWindow.start} -> ${result.summary.incidentWindow.end}`);
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
    lines.push(`- ${signal.label}${signal.description ? `: ${signal.description}` : ""}`);
  }
  lines.push("");
  lines.push("AI Analysis");
  lines.push("-----------");
  if (result.ai.available) {
    lines.push(result.ai.summary ?? "No AI summary.");
  } else {
    lines.push(result.ai.warning ?? "AI unavailable.");
  }
  return lines.join("\n");
}

export function renderJson(result: AnalysisResult): string {
  return JSON.stringify(result, null, 2);
}

export function renderMarkdown(result: AnalysisResult): string {
  const lines: string[] = [];
  lines.push("# SOLID Incident Report");
  lines.push("");
  lines.push("## Summary");
  lines.push(result.summary.incidentSummary);
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
  lines.push("## Flow");
  for (const edge of result.flow) {
    lines.push(`- ${edge.from} -> ${edge.to} (${edge.count} events, confidence ${Math.round(edge.confidence * 100)}%)`);
  }
  lines.push("");
  lines.push("## AI Analysis");
  lines.push(result.ai.available ? (result.ai.summary ?? "No AI summary.") : (result.ai.warning ?? "AI unavailable."));
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

