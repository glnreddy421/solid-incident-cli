import type { AnalysisResult, TraceGraphEdge } from "../contracts/index.js";

export function pct(x: number | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${Math.round(x * 100)}%`;
}

export function tbl(s: string): string {
  return s.replace(/\|/g, "/").replace(/\n/g, " ");
}

export function edgeStrength(e: TraceGraphEdge): number {
  const h = e.heuristicScore ?? 0;
  const m = e.mlScore ?? 0;
  const c = e.confidence ?? 0;
  const t = e.temporalConfidence ?? 0;
  return h * 1.2 + m * 1.1 + c + t * 0.5;
}

export function chronologicalTimelineLines(result: AnalysisResult, max = 16): string[] {
  const sorted = [...result.timeline].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return sorted.slice(0, max).map(
    (e) =>
      `${e.timestamp} [${e.severity}] ${e.service}: ${e.message.slice(0, 140)}${e.message.length > 140 ? "…" : ""}`,
  );
}

export function topSeverityTimelineLines(result: AnalysisResult, max = 6): string[] {
  const ranked = [...result.timeline].sort((a, b) => {
    const sev = (s: string) => ({ critical: 4, error: 3, warning: 2, info: 1, debug: 0 }[s] ?? 0);
    return sev(b.severity) - sev(a.severity) || (b.anomaly ? 1 : 0) - (a.anomaly ? 1 : 0);
  });
  return ranked.slice(0, max).map(
    (e) =>
      `${e.timestamp} [${e.severity}] ${e.service}: ${e.message.slice(0, 160)}${e.message.length > 160 ? "…" : ""}`,
  );
}

export function topologyLines(result: AnalysisResult): string[] {
  const edges: TraceGraphEdge[] =
    result.traceGraph?.edges?.length > 0
      ? [...result.traceGraph.edges]
      : result.flow.map(
          (e): TraceGraphEdge => ({
            from: e.from,
            to: e.to,
            annotation: "impact",
            count: e.count,
            confidence: e.confidence,
          }),
        );
  edges.sort((a, b) => edgeStrength(b) - edgeStrength(a));
  if (!edges.length) {
    return [
      "No propagation edges inferred — insufficient cross-service correlation in this window.",
    ];
  }
  return edges.slice(0, 16).map((e, i) => {
    const parts = [`${i + 1}. **${e.from} → ${e.to}**`, `"${e.annotation}"`, `~${e.count} events`];
    parts.push(`confidence ${pct(e.confidence)}`);
    if (e.heuristicScore != null) parts.push(`heuristic ${pct(e.heuristicScore)}`);
    if (e.mlScore != null) parts.push(`ML ${pct(e.mlScore)}`);
    if (e.temporalConfidence != null) parts.push(`temporal ${pct(e.temporalConfidence)}`);
    if (e.transitionReason) parts.push(`reason: ${e.transitionReason}`);
    if (e.keySignals?.length) parts.push(`signals: ${e.keySignals.slice(0, 4).join(", ")}`);
    return parts.join(" · ");
  });
}

export function signalsLines(result: AnalysisResult, max = 14): string[] {
  const sorted = [...result.signals].sort((a, b) => (b.score ?? b.count ?? 0) - (a.score ?? a.count ?? 0));
  const lines: string[] = [];
  for (const s of sorted.slice(0, max)) {
    const ml = s.mlScore != null ? ` ${s.scoreSource === "tfidf" ? "tf-idf" : "ml"}:${pct(s.mlScore)}` : "";
    lines.push(
      `[${s.severity}] **${s.label}**${s.service ? ` (${s.service})` : ""} — strength ${s.score ?? s.count ?? 1}${ml}${s.description ? ` — ${s.description}` : ""}`,
    );
  }
  if (!lines.length) lines.push("No structured detector signals.");
  if (result.mlEnrichment?.available) {
    lines.push(
      `ML layer **${result.mlEnrichment.modelType}** (${result.mlEnrichment.eventScores?.length ?? 0} event scores blended in engine).`,
    );
  }
  return lines;
}
