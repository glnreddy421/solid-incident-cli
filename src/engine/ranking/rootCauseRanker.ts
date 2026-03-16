import type { ParsedIncidentEvent, Signal } from "../../contracts/index.js";
import type { PropagationEdge } from "../propagation/propagationDetector.js";

export interface RootCauseCandidate {
  id: string;
  label: string;
  confidence: number;
  weightedScore: number;
  heuristicScore: number;
  topologyScore: number;
  temporalScore: number;
  severityScore: number;
  mlAnomalyScore: number;
  evidenceCount: number;
  directEvidence: string[];
  relatedSignals: string[];
  affectedServices: string[];
}

function scoreSeverity(events: ParsedIncidentEvent[]): number {
  const critical = events.filter((e) => e.severity === "critical").length;
  const error = events.filter((e) => e.severity === "error").length;
  const warn = events.filter((e) => e.severity === "warning").length;
  return Math.min(1, (critical * 1 + error * 0.7 + warn * 0.4) / Math.max(1, events.length));
}

function scoreTemporalConcentration(events: ParsedIncidentEvent[]): number {
  if (events.length < 2) return 0.2;
  const times = events
    .map((e) => (e.timestamp === "unknown" ? NaN : new Date(e.timestamp).getTime()))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (times.length < 2) return 0.2;
  const spanSec = Math.max(1, (times[times.length - 1] - times[0]) / 1000);
  return Math.min(1, (events.length / spanSec) * 25);
}

function weightedScore(s: { heuristicScore: number; topologyScore: number; temporalScore: number; severityScore: number; mlAnomalyScore: number }): number {
  return (
    s.heuristicScore * 0.4 +
    s.topologyScore * 0.2 +
    s.temporalScore * 0.15 +
    s.severityScore * 0.15 +
    s.mlAnomalyScore * 0.1
  );
}

function seedCandidateIds(signals: Signal[]): string[] {
  const ids: string[] = [];
  const labels = signals.map((s) => s.label);
  if (labels.some((l) => /connection_refused_pattern|db_unavailable_pattern/.test(l))) ids.push("database_connection_refused");
  if (labels.some((l) => /timeout_pattern|retry_burst/.test(l))) ids.push("dependency_timeout_chain");
  if (labels.some((l) => /restart_detected|crash_signature/.test(l))) ids.push("service_restart_loop");
  if (labels.some((l) => /auth_failure_cluster/.test(l))) ids.push("auth_token_expiration");
  if (labels.some((l) => /memory_pressure_pattern|oom_pattern/.test(l))) ids.push("resource_saturation_memory");
  if (labels.some((l) => /rate_limit_exhaustion/.test(l))) ids.push("rate_limit_exhaustion");
  if (!ids.length) ids.push("no_dominant_root_cause");
  return ids;
}

export function rankRootCauses(
  events: ParsedIncidentEvent[],
  signals: Signal[],
  propagationEdges: PropagationEdge[],
  mlEventScores: number[]
): RootCauseCandidate[] {
  const ids = seedCandidateIds(signals);
  const sevScore = scoreSeverity(events);
  const temporal = scoreTemporalConcentration(events);
  const topo = Math.min(1, propagationEdges.length / 4);
  const meanMl = mlEventScores.length ? mlEventScores.reduce((a, b) => a + b, 0) / mlEventScores.length : 0.2;

  const out: RootCauseCandidate[] = ids.map((id) => {
    const related = signals.filter((s) => id.includes("database") ? /connection_refused_pattern|db_unavailable_pattern/.test(s.label)
      : id.includes("timeout") ? /timeout_pattern|retry_burst/.test(s.label)
      : id.includes("restart") ? /restart_detected|crash_signature/.test(s.label)
      : id.includes("auth") ? /auth_failure_cluster/.test(s.label)
      : id.includes("memory") ? /memory_pressure_pattern/.test(s.label)
      : id.includes("rate_limit") ? /rate_limit_exhaustion/.test(s.label)
      : false);
    const heuristic = Math.min(1, related.reduce((acc, s) => acc + (s.score ?? s.count ?? 1) / 10, 0));
    const mlScore = Math.min(1, related.length ? related.reduce((a, s) => a + (s.mlScore ?? meanMl), 0) / related.length : meanMl * 0.6);
    const score = weightedScore({
      heuristicScore: heuristic,
      topologyScore: topo,
      temporalScore: temporal,
      severityScore: sevScore,
      mlAnomalyScore: mlScore,
    });
    const confidence = Math.min(0.98, 0.35 + score * 0.65);
    const evidenceEvents = events.filter((e) => related.some((r) => e.message.toLowerCase().includes(r.label.split("_")[0])));
    return {
      id,
      label: id.replaceAll("_", " "),
      confidence,
      weightedScore: score,
      heuristicScore: heuristic,
      topologyScore: topo,
      temporalScore: temporal,
      severityScore: sevScore,
      mlAnomalyScore: mlScore,
      evidenceCount: evidenceEvents.length,
      directEvidence: evidenceEvents.slice(0, 3).map((e) => `${e.service}: ${e.message.slice(0, 90)}`),
      relatedSignals: related.map((s) => s.label),
      affectedServices: [...new Set(evidenceEvents.map((e) => e.service))],
    };
  });

  return out.sort((a, b) => b.weightedScore - a.weightedScore);
}

