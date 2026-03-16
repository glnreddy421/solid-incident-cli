import type { ParsedIncidentEvent, TraceGraphEdge } from "../../contracts/index.js";

export interface PropagationEdge extends TraceGraphEdge {
  transitionReason: string;
  temporalConfidence: number;
}

function classifyTransitionReason(from: ParsedIncidentEvent, to: ParsedIncidentEvent): string {
  if (from.correlationId && to.correlationId && from.correlationId === to.correlationId) return "shared-correlation-id";
  if (to.inferredDependencies.some((d) => from.service.toLowerCase().includes(d) || d.includes(from.service.toLowerCase()))) return "dependency-reference";
  if (to.normalizedType === "timeout" || to.normalizedType === "connection_refused") return "downstream-failure-pattern";
  return "temporal-adjacency";
}

function timeDiffSec(a: string, b: string): number {
  if (a === "unknown" || b === "unknown") return 9999;
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 1000;
}

export function detectPropagation(events: ParsedIncidentEvent[]): PropagationEdge[] {
  const edges = new Map<string, PropagationEdge>();
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1];
    const curr = events[i];
    if (!prev.service || !curr.service || prev.service === curr.service) continue;
    const key = `${prev.service}->${curr.service}`;
    const reason = classifyTransitionReason(prev, curr);
    const delta = timeDiffSec(prev.timestamp, curr.timestamp);
    const temporalConfidence = delta <= 30 ? 0.9 : delta <= 120 ? 0.7 : 0.45;
    const base = edges.get(key);
    if (base) {
      base.count += 1;
      base.confidence = Math.min(0.98, base.confidence + 0.04);
      base.heuristicScore = Math.min(0.98, (base.heuristicScore ?? 0.5) + 0.03);
      base.temporalConfidence = Math.max(base.temporalConfidence, temporalConfidence);
    } else {
      edges.set(key, {
        from: prev.service,
        to: curr.service,
        annotation: curr.normalizedType,
        count: 1,
        confidence: 0.55,
        heuristicScore: 0.55,
        keySignals: [curr.normalizedType],
        transitionReason: reason,
        temporalConfidence,
      });
    }
  }
  return [...edges.values()].sort((a, b) => (b.heuristicScore ?? b.confidence) - (a.heuristicScore ?? a.confidence));
}

