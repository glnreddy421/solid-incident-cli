import type { ParsedIncidentEvent, Signal } from "../../contracts/index.js";

export interface TrustDiagnostics {
  parseCoverage: number;
  timestampCoverage: number;
  serviceCoverage: number;
  severityCoverage: number;
  evidenceDensity: number;
  ambiguityFlags: string[];
}

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

export function buildTrustDiagnostics(events: ParsedIncidentEvent[], signals: Signal[]): TrustDiagnostics {
  const total = events.length;
  const parseCoverage = pct(events.filter((e) => e.parseConfidence >= 0.7).length, total);
  const timestampCoverage = pct(events.filter((e) => e.timestamp !== "unknown").length, total);
  const serviceCoverage = pct(events.filter((e) => e.service !== "unknown-service").length, total);
  const severityCoverage = pct(events.filter((e) => !!e.severity).length, total);
  const evidenceDensity = total > 0 ? Number((signals.reduce((a, s) => a + (s.count ?? 0), 0) / total).toFixed(2)) : 0;
  const ambiguityFlags: string[] = [];
  if (total < 3) ambiguityFlags.push("sparse_log_window");
  if (timestampCoverage < 70) ambiguityFlags.push("low_timestamp_coverage");
  if (serviceCoverage < 70) ambiguityFlags.push("low_service_coverage");
  if (parseCoverage < 70) ambiguityFlags.push("low_parse_coverage");
  if (signals.length === 0) ambiguityFlags.push("insufficient_classification_evidence");

  return {
    parseCoverage,
    timestampCoverage,
    serviceCoverage,
    severityCoverage,
    evidenceDensity,
    ambiguityFlags,
  };
}

