import type {
  EventDistribution,
  IncidentAssessment,
  IncidentSeverity,
  IncidentVerdict,
  RawLogLine,
  Signal,
  TimelineEntry,
  TraceGraph,
  TriggerClassification,
  TriggerImpact,
} from "../contracts/index.js";
import { deriveHumanExplanation, deriveSuggestedCauses, deriveSuggestedFixes } from "./suggestedCausesAndFixes.js";

interface AssessmentInput {
  timeline: TimelineEntry[];
  traceGraph: TraceGraph;
  signals: Signal[];
  rawLines?: RawLogLine[];
}

const ROUTINE_PATTERNS = [
  /asl sender statistics/i,
  /telemetry|heartbeat|health.?check|metrics/i,
  /started|listening|ready/i,
];
const DEPENDENCY_FAILURE_PATTERNS = [/connection refused|dns|upstream|dependency|pool exhausted/i];
const RESTART_PATTERNS = [/crashloop|back-?off|restarting failed container|restart/i];
const FAILURE_PATTERNS = [/timeout|deadline exceeded|panic|fatal|exception|5\d\d|error/i];
const WARNING_PATTERNS = [/warn|retry|throttl|degraded|slow/i];
const MEMORY_PATTERNS = [/oom|memory pressure|out of memory/i];

function severityCounts(timeline: TimelineEntry[]): EventDistribution {
  return timeline.reduce<EventDistribution>(
    (acc, e) => {
      if (e.severity === "warning") acc.warn += 1;
      else if (e.severity === "error" || e.severity === "critical") acc.error += 1;
      else acc.info += 1;
      if (e.anomaly) acc.anomaly += 1;
      return acc;
    },
    { info: 0, warn: 0, error: 0, anomaly: 0 }
  );
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

export function classifyTrigger(logEvent?: TimelineEntry): TriggerClassification {
  if (!logEvent) return "unknown";
  const msg = logEvent.message ?? "";
  if (logEvent.severity === "info" || logEvent.severity === "debug") {
    if (matchesAny(msg, ROUTINE_PATTERNS)) return "routine_telemetry";
  }
  if (/connection refused|dial tcp/i.test(msg)) return "connection_refused_pattern";
  if (/timeout|deadline exceeded|timed out/i.test(msg)) return "timeout_pattern";
  if (/latency|degraded|slow/i.test(msg)) return "latency_outlier";
  if (matchesAny(msg, DEPENDENCY_FAILURE_PATTERNS)) return "dependency_failure";
  if (matchesAny(msg, RESTART_PATTERNS)) return "restart_event";
  if (matchesAny(msg, FAILURE_PATTERNS)) return "failure_pattern";
  if (matchesAny(msg, WARNING_PATTERNS) || logEvent.severity === "warning") return "warning_pattern";
  if (logEvent.anomaly) return "anomaly";
  return "unknown";
}

function triggerImpactFor(classification: TriggerClassification): TriggerImpact {
  switch (classification) {
    case "routine_telemetry":
      return "none";
    case "warning_pattern":
      return "low";
    case "anomaly":
      return "medium";
    case "failure_pattern":
    case "timeout_pattern":
    case "connection_refused_pattern":
      return "high";
    case "latency_outlier":
      return "medium";
    case "dependency_failure":
    case "restart_event":
      return "critical";
    default:
      return "low";
  }
}

export function deriveVerdict(input: AssessmentInput): IncidentVerdict {
  const counts = severityCounts(input.timeline);
  const total = input.timeline.length;
  if (total < 3) return "INSUFFICIENT EVIDENCE";
  const hasFailureSignals = input.signals.some((s) =>
    /(dependency_failure_chain|connection_refused_pattern|restart_detected|timeout_pattern|error_rate_spike|crash_signature|memory_pressure_pattern)/.test(
      s.label
    )
  );
  if (counts.error === 0 && counts.warn === 0 && counts.anomaly === 0) return "NO INCIDENT";
  if (counts.error > 0 && (hasFailureSignals || input.traceGraph.edges.length > 0)) return "INCIDENT DETECTED";
  if (counts.error >= 2 || (counts.error > 0 && counts.anomaly >= 3)) return "INCIDENT DETECTED";
  if (counts.warn > 0 || counts.anomaly > 0) return "POSSIBLE DEGRADATION";
  return "INSUFFICIENT EVIDENCE";
}

export function deriveSeverity(
  verdict: IncidentVerdict,
  timeline: TimelineEntry[],
  triggerClassification: TriggerClassification
): IncidentSeverity {
  const counts = severityCounts(timeline);
  if (verdict === "NO INCIDENT") return "none";
  if (verdict === "INSUFFICIENT EVIDENCE") return "low";
  if (verdict === "POSSIBLE DEGRADATION") return counts.warn > 3 || counts.anomaly > 2 ? "medium" : "low";
  if (triggerClassification === "dependency_failure" || triggerClassification === "restart_event") return "critical";
  if (timeline.some((e) => e.severity === "critical")) return "critical";
  if (counts.error > 2) return "high";
  return "medium";
}

function computeHealthScore(distribution: EventDistribution, signalCount: number, traceEdges: number): number {
  let score = 100;
  score -= Math.min(50, distribution.error * 12);
  score -= Math.min(25, distribution.warn * 5);
  score -= Math.min(15, distribution.anomaly * 4);
  score -= Math.min(10, traceEdges * 3);
  score -= Math.min(10, signalCount * 2);
  return Math.max(0, Math.min(100, score));
}

function deriveSystemHealthSummary(
  distribution: EventDistribution,
  signals: Signal[],
  traceGraph: TraceGraph
): string[] {
  const out: string[] = [];
  if (distribution.error === 0 && distribution.warn === 0) {
    out.push("No error or warning patterns detected.");
  } else if (distribution.error === 0) {
    out.push("Warning patterns detected without confirmed error propagation.");
  } else {
    out.push("Error patterns detected in analysis window.");
  }
  if (!signals.some((s) => /dependency_failure_chain|connection_refused_pattern/.test(s.label))) {
    out.push("No service dependency failures observed.");
  } else {
    out.push("Dependency failure indicators are present.");
  }
  if (!signals.some((s) => /restart_detected|crash_signature/.test(s.label))) {
    out.push("No restart events detected.");
  } else {
    out.push("Restart or crash signatures detected.");
  }
  if (traceGraph.edges.length > 0) {
    out.push("Propagation chain detected across multiple services.");
  }
  return out;
}

function extractTriggerMetadata(rawLine?: string): { service?: string; event?: string; pid?: string; host?: string } {
  if (!rawLine) return {};
  const pidMatch = rawLine.match(/\[([0-9]+)\]/);
  const hostMatch = rawLine.match(/^\w{3}\s+\d+\s+\d+:\d+:\d+\s+([^\s]+)\s+/);
  const servicePidMatch = rawLine.match(/\s([a-zA-Z0-9_.-]+)\[[0-9]+\]:/);
  const serviceJsonMatch = rawLine.match(/"service"\s*:\s*"([^"]+)"/);
  let event: string | undefined;
  if (rawLine.trimStart().startsWith("{")) {
    try {
      const parsed = JSON.parse(rawLine) as { msg?: string; message?: string };
      event = (parsed.msg ?? parsed.message)?.slice(0, 120);
    } catch {
      event = rawLine.match(/"msg"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/)?.[1]?.replace(/\\"/g, '"')?.slice(0, 120);
    }
  }
  if (!event) {
    const msgMatch = rawLine.match(/:\s(.+)$/);
    event = msgMatch?.[1]?.replace(/\\"/g, '"')?.slice(0, 120);
  }
  return {
    service: serviceJsonMatch?.[1] ?? servicePidMatch?.[1],
    event,
    pid: pidMatch?.[1],
    host: hostMatch?.[1],
  };
}

export function generateSummaryNarrative(
  timeline: TimelineEntry[],
  distribution: EventDistribution,
  serviceCount: number,
  traceGraphEdges: number
): string {
  const total = timeline.length;
  if (total === 0) return "No structured events were parsed from input logs.";
  if (distribution.warn === 0 && distribution.error === 0) {
    return `Parsed ${total} log events across ${serviceCount} service${serviceCount === 1 ? "" : "s"}. All observed events were informational; no warning or error patterns were detected.`;
  }
  if (distribution.error === 0 && distribution.warn > 0) {
    return `Parsed ${total} log events across ${serviceCount} service${serviceCount === 1 ? "" : "s"}. Warning patterns were detected in ${Math.min(
      serviceCount,
      Math.max(1, distribution.warn)
    )} service${serviceCount === 1 ? "" : "s"}; review timeline and strongest signals.`;
  }
  if (distribution.error > 0 && traceGraphEdges > 0) {
    return `Parsed ${total} log events across ${serviceCount} service${serviceCount === 1 ? "" : "s"}. Error propagation was detected across dependent services.`;
  }
  return `Parsed ${total} log events across ${serviceCount} service${serviceCount === 1 ? "" : "s"}. Errors were detected; inspect trigger classification and strongest signals.`;
}

export function generateRecommendedActions(verdict: IncidentVerdict): string[] {
  if (verdict === "NO INCIDENT") {
    return [
      "No immediate action required.",
      "Expand analysis window only if additional symptoms were observed.",
      "Correlate with adjacent logs or metrics if a failure was expected in this run.",
    ];
  }
  if (verdict === "POSSIBLE DEGRADATION") {
    return [
      "Check recent warnings around the trigger timestamp.",
      "Review service latency and retry behavior.",
      "Compare current warning profile with a prior baseline window.",
    ];
  }
  if (verdict === "INCIDENT DETECTED") {
    return [
      "Inspect the root failing service and trigger event details.",
      "Review dependency chain and restart events in trace graph.",
      "Correlate with deploy/config changes near trigger time.",
      "Check infra metrics (CPU, memory, network, DB saturation).",
    ];
  }
  return [
    "Insufficient evidence for incident determination.",
    "Load additional logs around the suspected time window.",
    "Include adjacent service logs or metrics for correlation.",
  ];
}

export function deriveEvidenceSignals(timeline: TimelineEntry[], traceGraph: TraceGraph): Signal[] {
  const distribution = severityCounts(timeline);
  const all = timeline.map((t) => t.message).join("\n");
  const signals: Signal[] = [];
  if (distribution.info > 0) {
    signals.push({
      label: "informational_log_cluster",
      severity: "info",
      count: distribution.info,
      description: `${distribution.info} informational events observed`,
    });
  }
  if (distribution.warn >= 2) {
    signals.push({ label: "warning_burst", severity: "warning", count: distribution.warn, description: "Warning volume exceeded baseline." });
  }
  if ((all.match(/retry|attempt \d+/gi) ?? []).length >= 3) {
    signals.push({ label: "retry_burst", severity: "warning", count: (all.match(/retry|attempt \d+/gi) ?? []).length, description: "Retry burst pattern detected." });
  }
  if (distribution.error >= 2) {
    signals.push({ label: "error_rate_spike", severity: "error", count: distribution.error, description: "Error volume spike detected." });
  }
  if (RESTART_PATTERNS.some((p) => p.test(all))) {
    signals.push({ label: "restart_detected", severity: "critical", count: 1, description: "Restart/CrashLoop signature present." });
    signals.push({ label: "crash_signature", severity: "critical", count: 1, description: "Crash/back-off pattern detected." });
  }
  if (/timeout|deadline exceeded|timed out/i.test(all)) {
    signals.push({ label: "timeout_pattern", severity: "error", count: 1, description: "Timeout/deadline pattern detected." });
  }
  if (/connection refused|dial tcp|dependency/i.test(all)) {
    signals.push({
      label: "connection_refused_pattern",
      severity: "error",
      count: (all.match(/connection refused|dial tcp/gi) ?? []).length || 1,
      description: "Connection refused/dependency failure signature detected.",
    });
  }
  if (/auth.*fail|unauthorized|forbidden|token.*invalid/i.test(all)) {
    signals.push({ label: "auth_failure_cluster", severity: "error", count: 1, description: "Auth/token failure signatures detected." });
  }
  if (/latency|slow|degraded/i.test(all)) {
    signals.push({ label: "latency_outlier", severity: "warning", count: 1, description: "Latency outlier pattern detected." });
  }
  if (MEMORY_PATTERNS.some((p) => p.test(all))) {
    signals.push({ label: "memory_pressure_pattern", severity: "critical", count: 1, description: "OOM/memory pressure signature detected." });
  }
  if (traceGraph.edges.length >= 2 && signals.some((s) => s.severity === "error" || s.severity === "critical")) {
    signals.push({
      label: "dependency_failure_chain",
      severity: "critical",
      count: traceGraph.edges.length,
      description: "Failure propagation across multiple services.",
    });
  }
  if (distribution.error === 0) {
    signals.push({ label: "no_error_patterns", severity: "info", count: 1, description: "No error signatures observed." });
  }
  if (!signals.some((s) => /dependency_failure_chain|connection_refused_pattern/.test(s.label))) {
    signals.push({ label: "no_dependency_failures", severity: "info", count: 1, description: "No dependency failure chain observed." });
  }
  if (distribution.warn === 0 && distribution.error === 0) {
    signals.push({ label: "stable_service_behavior", severity: "info", count: 1, description: "Service behavior appears stable." });
  }

  const dedup = new Map<string, Signal>();
  for (const s of signals) dedup.set(s.label, s);
  return [...dedup.values()];
}

export function detectPropagation(traceGraph: TraceGraph): string[] {
  if (!traceGraph.edges.length) return [];
  const sorted = [...traceGraph.edges].sort((a, b) => (b.heuristicScore ?? b.confidence) - (a.heuristicScore ?? a.confidence));
  return sorted
    .slice(0, 6)
    .map(
      (e) =>
        `${e.from} -> ${e.to} | ${e.annotation} | reason=${e.transitionReason ?? "unknown"} | temporal=${Math.round((e.temporalConfidence ?? 0) * 100)}% | evidence=${e.count}`
    );
}

export function rankRootCauses(signals: Signal[], traceGraph: TraceGraph): Array<{ id: string; confidence: number; evidence: string }> {
  const candidates: Array<{ id: string; confidence: number; evidence: string }> = [];
  const add = (id: string, confidence: number, evidence: string): void => {
    const existing = candidates.find((c) => c.id === id);
    if (existing) {
      existing.confidence = Math.max(existing.confidence, confidence);
      return;
    }
    candidates.push({ id, confidence: Math.min(0.98, confidence), evidence });
  };
  for (const sig of signals) {
    const base = Math.min(0.9, 0.45 + (sig.score ?? sig.count ?? 1) / 15);
    if (/connection_refused_pattern|dependency_failure_chain/.test(sig.label)) {
      add("database_connection_refused", base + 0.15, sig.description ?? sig.label);
    } else if (/timeout_pattern|retry_burst|error_rate_spike/.test(sig.label)) {
      add("dependency_timeout_chain", base + 0.1, sig.description ?? sig.label);
    } else if (/restart_detected|crash_signature/.test(sig.label)) {
      add("service_restart", base + 0.08, sig.description ?? sig.label);
    } else if (/auth_failure_cluster/.test(sig.label)) {
      add("auth_failure_cluster", base, sig.description ?? sig.label);
    } else if (/memory_pressure_pattern/.test(sig.label)) {
      add("memory_pressure", base + 0.05, sig.description ?? sig.label);
    }
  }
  if (traceGraph.edges.length >= 2) {
    add("propagation_chain", 0.62 + Math.min(0.2, traceGraph.edges.length * 0.04), `${traceGraph.edges.length} propagation edges`);
  }
  if (!candidates.length) {
    add("no_dominant_root_cause", 0.35, "No dominant root cause pattern identified.");
  }
  return candidates.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

export function reconstructTimeline(timeline: TimelineEntry[]): string[] {
  if (!timeline.length) return ["No timeline events available."];
  return timeline.slice(0, 50).map((e) => {
    const eventType =
      e.severity === "critical" || e.severity === "error"
        ? "failure event"
        : e.severity === "warning"
          ? "warning event"
          : "routine telemetry event";
    const ts = e.timestamp === "unknown" ? "unknown" : new Date(e.timestamp).toISOString().slice(11, 19);
    return `${ts} ${e.service} ${eventType}`;
  });
}

export function deriveAssessment(input: AssessmentInput): IncidentAssessment {
  const distribution = severityCounts(input.timeline);
  const triggerEvent = input.timeline.find((e) => e.anomaly) ?? input.timeline[0];
  const triggerMeta = extractTriggerMetadata(
    triggerEvent?.lineNumber ? input.rawLines?.[triggerEvent.lineNumber - 1]?.line : input.rawLines?.[0]?.line
  );
  const triggerClassification = classifyTrigger(triggerEvent);
  const verdict = deriveVerdict(input);
  const severity = deriveSeverity(verdict, input.timeline, triggerClassification);
  const serviceSet = new Set(input.timeline.map((e) => e.service).filter(Boolean));
  const knownServices = input.timeline.filter((e) => e.service && e.service !== "unknown-service").map((e) => e.service);
  const primaryService =
    (triggerMeta.service && triggerMeta.service !== "unknown-service" ? triggerMeta.service : undefined) ||
    (triggerEvent?.service && triggerEvent.service !== "unknown-service" ? triggerEvent.service : undefined) ||
    input.timeline.find((e) => (e.severity === "critical" || e.severity === "error" || e.severity === "warning") && e.service !== "unknown-service")?.service ||
    knownServices[0] ||
    input.timeline[0]?.service ||
    "unknown-service";
  const summaryNarrative = generateSummaryNarrative(
    input.timeline,
    distribution,
    serviceSet.size || 1,
    input.traceGraph.edges.length
  );

  let verdictReason = "Evidence did not match a stable incident pattern.";
  if (verdict === "NO INCIDENT") verdictReason = "Only routine informational activity detected.";
  if (verdict === "POSSIBLE DEGRADATION") verdictReason = "Warnings/anomaly signals detected without a confirmed failure chain.";
  if (verdict === "INCIDENT DETECTED") verdictReason = "Failure patterns and/or propagation signals indicate active incident behavior.";
  if (verdict === "INSUFFICIENT EVIDENCE") verdictReason = "Log sample is sparse or weakly classified.";

  const strongestSignals = [...input.signals]
    .sort((a, b) => (b.score ?? b.count ?? 0) - (a.score ?? a.count ?? 0))
    .map((s) => s.label)
    .slice(0, 5);
  const propagationChain = detectPropagation(input.traceGraph);
  const rootCauseCandidates = rankRootCauses(input.signals, input.traceGraph);
  const reconstructed = reconstructTimeline(input.timeline);
  const healthScore = computeHealthScore(distribution, input.signals.length, input.traceGraph.edges.length);
  const systemHealthSummary = deriveSystemHealthSummary(distribution, input.signals, input.traceGraph);

  const assessment: IncidentAssessment = {
    verdict,
    severity,
    healthScore,
    verdictReason,
    triggerClassification,
    triggerImpact: triggerImpactFor(triggerClassification),
    triggerService: primaryService,
    triggerEvent: triggerEvent?.message?.slice(0, 120) || triggerMeta.event || "No trigger identified",
    triggerPid: triggerMeta.pid,
    triggerHost: triggerMeta.host,
    triggerTimestamp: triggerEvent?.timestamp ?? "unknown",
    primaryService,
    serviceCount: serviceSet.size || (input.timeline.length ? 1 : 0),
    anomalyCount: distribution.anomaly,
    eventDistribution: distribution,
    systemHealthSummary,
    strongestSignals,
    rootCauseCandidates,
    reconstructedTimeline: reconstructed,
    propagationChain,
    summaryNarrative,
    recommendedActions: generateRecommendedActions(verdict),
  };
  assessment.suggestedCauses = deriveSuggestedCauses(assessment, input.signals);
  assessment.suggestedFixes = deriveSuggestedFixes(assessment, input.signals);
  assessment.humanExplanation = deriveHumanExplanation(assessment, assessment.suggestedCauses, assessment.suggestedFixes);
  return assessment;
}

