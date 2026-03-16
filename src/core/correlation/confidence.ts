import type { CanonicalEvent } from "../../utils/inputAdapters/types.js";
import { eventTime, linkageTokens } from "./utils.js";

export interface ConfidenceInput {
  events: CanonicalEvent[];
  base?: number;
  ambiguityPenalty?: number;
  conflictPenalty?: number;
}

export interface ConfidenceBreakdown {
  confidence: number;
  supportingEvents: number;
  orderingConsistency: number;
  timeAlignment: number;
  linkageQuality: number;
  sourceDiversity: number;
  ambiguityPenalty: number;
  conflictPenalty: number;
}

function clamp(v: number): number {
  return Math.max(0.05, Math.min(0.98, v));
}

export function classifyStrength(
  confidence: number,
  sourceCount: number,
): "single-source-inferred" | "multi-source-corroborated" | "high-confidence-cross-source" {
  if (sourceCount >= 2 && confidence >= 0.82) return "high-confidence-cross-source";
  if (sourceCount >= 2) return "multi-source-corroborated";
  return "single-source-inferred";
}

export function scoreConfidence(input: ConfidenceInput): ConfidenceBreakdown {
  const events = [...input.events].sort((a, b) => eventTime(a) - eventTime(b));
  const supportingEvents = Math.min(1, events.length / 8);
  let inversions = 0;
  for (let i = 1; i < events.length; i++) {
    if (eventTime(events[i]) < eventTime(events[i - 1])) inversions += 1;
  }
  const orderingConsistency = events.length <= 1 ? 0.7 : Math.max(0.2, 1 - inversions / Math.max(1, events.length - 1));
  const spanMs = events.length > 1 ? eventTime(events[events.length - 1]) - eventTime(events[0]) : 0;
  const timeAlignment = events.length <= 1 ? 0.45 : Math.max(0.2, Math.min(1, 1 - spanMs / (5 * 60 * 1000)));
  const sourceDiversity = Math.min(1, new Set(events.map((e) => e.sourceId).filter(Boolean)).size / 3);
  const linkageDensity = events.length === 0 ? 0 : events.reduce((acc, event) => acc + linkageTokens(event).length, 0) / events.length;
  const linkageQuality = Math.min(1, linkageDensity / 4);
  const ambiguityPenalty = input.ambiguityPenalty ?? (events.length > 0 && linkageDensity < 1.2 ? 0.14 : 0.06);
  const conflictPenalty = input.conflictPenalty ?? 0.04;
  const base = input.base ?? 0.25;
  const confidence = clamp(
    base +
    supportingEvents * 0.24 +
    orderingConsistency * 0.18 +
    timeAlignment * 0.18 +
    linkageQuality * 0.18 +
    sourceDiversity * 0.22 -
    ambiguityPenalty -
    conflictPenalty
  );
  return {
    confidence: Number(confidence.toFixed(2)),
    supportingEvents: Number(supportingEvents.toFixed(2)),
    orderingConsistency: Number(orderingConsistency.toFixed(2)),
    timeAlignment: Number(timeAlignment.toFixed(2)),
    linkageQuality: Number(linkageQuality.toFixed(2)),
    sourceDiversity: Number(sourceDiversity.toFixed(2)),
    ambiguityPenalty: Number(ambiguityPenalty.toFixed(2)),
    conflictPenalty: Number(conflictPenalty.toFixed(2)),
  };
}

