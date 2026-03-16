import type { ParsedIncidentEvent, RawLogLine, TimelineEntry } from "../../contracts/index.js";

const TYPE_PATTERNS: Array<{ type: string; pattern: RegExp; tags: string[] }> = [
  { type: "connection_refused", pattern: /connection refused|econnrefused|failed to connect|dial tcp/i, tags: ["dependency", "failure"] },
  { type: "timeout", pattern: /timed out|deadline exceeded|context deadline exceeded|timeout/i, tags: ["timeout", "failure"] },
  { type: "retry", pattern: /retrying|retry|attempt\s+\d+\/?\d*|backoff|back-off/i, tags: ["retry"] },
  { type: "restart_event", pattern: /restart|restarting|crashloop|back-?off restarting failed/i, tags: ["restart", "failure"] },
  { type: "oom", pattern: /out of memory|oom-?killer|oomkilled|killed process/i, tags: ["resource_pressure", "memory"] },
  { type: "auth_failure", pattern: /401|unauthorized|forbidden|token expired|auth.*fail/i, tags: ["auth", "failure"] },
  { type: "latency_outlier", pattern: /latency|slow|degraded|p\d{2,3}\s*latency/i, tags: ["latency", "degradation"] },
  { type: "rate_limit_exhaustion", pattern: /429|rate limit|throttl|quota exceeded/i, tags: ["rate_limit", "degradation"] },
  { type: "db_unavailable", pattern: /db unavailable|database unavailable|could not connect to db|postgres.*down/i, tags: ["database", "failure"] },
];

function extractCorrelationId(text: string): string | undefined {
  const m = text.match(/(?:trace[_-]?id|request[_-]?id|correlation[_-]?id)[\s=:]+["']?([a-zA-Z0-9-_.]+)/i);
  return m?.[1];
}

function inferDependencies(text: string): string[] {
  const deps: string[] = [];
  const patterns = [
    /redis/i,
    /postgres|postgresql|db|database/i,
    /kafka|queue|rabbitmq|sqs/i,
    /auth-service|auth/i,
    /api-gateway|gateway/i,
    /dns/i,
  ];
  for (const p of patterns) {
    const mm = text.match(p);
    if (mm) deps.push(mm[0].toLowerCase());
  }
  return [...new Set(deps)];
}

function extractHost(rawLine: string): string | undefined {
  const m = rawLine.match(/^\w{3}\s+\d+\s+\d+:\d+:\d+\s+([^\s]+)\s+/);
  return m?.[1];
}

function extractPid(rawLine: string): string | undefined {
  const m = rawLine.match(/\[(\d+)\]/);
  return m?.[1];
}

export function normalizeTimelineEvents(timeline: TimelineEntry[], rawLines: RawLogLine[]): ParsedIncidentEvent[] {
  const rawByLineNumber = new Map(rawLines.map((line) => [line.lineNumber, line] as const));
  return timeline.map((event, idx) => {
    const rawRef = event.lineNumber != null ? rawByLineNumber.get(event.lineNumber) : undefined;
    const rawLine = rawRef?.line ?? event.message;
    const matched = TYPE_PATTERNS.find((p) => p.pattern.test(event.message));
    const normalizedType = matched?.type ?? (event.severity === "info" ? "informational_telemetry" : "unknown");
    const tags = [...(matched?.tags ?? []), event.anomaly ? "anomaly" : "normal"];
    return {
      rawLine,
      timestamp: event.timestamp,
      host: extractHost(rawLine),
      service: event.service,
      source: rawRef?.source,
      sourceName: rawRef?.sourceName,
      pid: extractPid(rawLine),
      severity: event.severity,
      message: event.message,
      normalizedType,
      tags,
      correlationId: extractCorrelationId(rawLine),
      inferredDependencies: inferDependencies(rawLine),
      parseConfidence: event.timestamp !== "unknown" && event.service !== "unknown-service" ? 0.9 : 0.55,
    };
  });
}

