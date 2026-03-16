import type { ParsedIncidentEvent, Signal } from "../../contracts/index.js";

interface SignalDraft {
  key: string;
  severity: Signal["severity"];
  description: string;
  supportingEventIndexes: number[];
}

function addSignal(map: Map<string, SignalDraft>, key: string, severity: Signal["severity"], description: string, idx: number): void {
  const existing = map.get(key);
  if (existing) {
    existing.supportingEventIndexes.push(idx);
    return;
  }
  map.set(key, { key, severity, description, supportingEventIndexes: [idx] });
}

export function detectRuleSignals(events: ParsedIncidentEvent[]): Signal[] {
  const map = new Map<string, SignalDraft>();
  const typeIndexes = new Map<string, number[]>();

  events.forEach((e, idx) => {
    const arr = typeIndexes.get(e.normalizedType) ?? [];
    arr.push(idx);
    typeIndexes.set(e.normalizedType, arr);

    if (e.normalizedType === "informational_telemetry") addSignal(map, "informational_log_cluster", "info", "Informational telemetry cluster detected.", idx);
    if (e.normalizedType === "timeout") addSignal(map, "timeout_pattern", "error", "Timeout/deadline exceeded pattern observed.", idx);
    if (e.normalizedType === "retry") addSignal(map, "retry_burst", "warning", "Retry burst behavior observed.", idx);
    if (e.normalizedType === "connection_refused") addSignal(map, "connection_refused_pattern", "error", "Connection refused signatures observed.", idx);
    if (e.normalizedType === "restart_event") {
      addSignal(map, "restart_detected", "critical", "Service restart loop signal detected.", idx);
      addSignal(map, "crash_signature", "critical", "Crash/restart signature observed.", idx);
    }
    if (e.normalizedType === "oom") addSignal(map, "memory_pressure_pattern", "critical", "Memory pressure/OOM signatures observed.", idx);
    if (e.normalizedType === "auth_failure") addSignal(map, "auth_failure_cluster", "error", "Auth failure cluster detected.", idx);
    if (e.normalizedType === "latency_outlier") addSignal(map, "latency_outlier", "warning", "Latency outlier pattern observed.", idx);
    if (e.normalizedType === "rate_limit_exhaustion") addSignal(map, "rate_limit_exhaustion", "warning", "Rate-limit or throttling pattern observed.", idx);
    if (e.normalizedType === "db_unavailable") addSignal(map, "db_unavailable_pattern", "critical", "Database unavailable signatures observed.", idx);
  });

  if ((typeIndexes.get("informational_telemetry")?.length ?? 0) > 0 && (events.filter((e) => e.severity === "warning" || e.severity === "error" || e.severity === "critical").length === 0)) {
    map.set("stable_service_behavior", {
      key: "stable_service_behavior",
      severity: "info",
      description: "No unstable behavior detected in analyzed window.",
      supportingEventIndexes: typeIndexes.get("informational_telemetry") ?? [],
    });
    map.set("no_error_patterns", {
      key: "no_error_patterns",
      severity: "info",
      description: "No error signatures observed.",
      supportingEventIndexes: [],
    });
    map.set("no_dependency_failures", {
      key: "no_dependency_failures",
      severity: "info",
      description: "No dependency failure signatures observed.",
      supportingEventIndexes: [],
    });
  }

  if (events.length < 3) {
    map.set("sparse_log_window", {
      key: "sparse_log_window",
      severity: "warning",
      description: "Sparse log window; conclusions may be weak.",
      supportingEventIndexes: events.map((_, i) => i),
    });
  }

  return [...map.values()].map((s) => ({
    label: s.key,
    severity: s.severity,
    count: s.supportingEventIndexes.length,
    score: Math.min(10, 1 + s.supportingEventIndexes.length),
    description: `${s.description} (${s.supportingEventIndexes.length} evidence event${s.supportingEventIndexes.length === 1 ? "" : "s"})`,
  }));
}

