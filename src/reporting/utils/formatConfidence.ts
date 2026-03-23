/** Numeric summary confidence (0–100) → human line for reports */
export function formatSummaryConfidenceLine(confidence: number | undefined, state: import("../types.js").ReportState): string {
  const c = confidence ?? 0;
  if (state === "live" || state === "snapshot") {
    return `Summary confidence (engine, current window): **${c}%** — may shift as the stream grows.`;
  }
  if (state === "partial") {
    return `Summary confidence: **${c}%** — **tentative** given limited evidence.`;
  }
  return `Summary confidence (engine): **${c}%**.`;
}

/** Candidate confidence 0–1 → short label */
export function formatCandidateConfidence(p: number | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return `${Math.round(p * 100)}%`;
}
