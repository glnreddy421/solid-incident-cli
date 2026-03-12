/**
 * Mock analysis engine: heuristics only, no backend.
 * Produces believable signals and summary from parsed events.
 */

import type { ParsedEvent, Signal, IncidentSummary, AnalysisResult, Severity } from "../utils/types.js";
import { parseLines } from "../utils/parser.js";

const PATTERNS = {
  connectionRefused: /connection refused|refused|connect: connection refused/i,
  timeout: /timeout|deadline exceeded|timed out/i,
  crashloop: /crashloop|back-off|backoff|restarting failed container/i,
  scaledToZero: /scaled to 0|scale.*0|replicas.*0/i,
  podDeleted: /pod deleted|poddeleted/i,
  retry: /retry|attempt \d+/i,
  throttl: /throttl|rate limit/i,
  poolExhausted: /pool exhausted|connection pool/i,
  authError: /auth.*(?:fail|error|denied)|token.*(?:invalid|expired)/i,
} as const;

export function runMockAnalysis(rawLines: { line: string; lineNumber: number }[]): AnalysisResult {
  const events = parseLines(rawLines as { line: string; lineNumber: number; source?: "file" | "stdin" }[]);
  const signals = detectSignals(events);
  const summary = buildSummary(events, signals);
  return {
    events,
    signals,
    summary,
    rawLineCount: rawLines.length,
  };
}

function detectSignals(events: ParsedEvent[]): Signal[] {
  const signals: Signal[] = [];
  const refusals = events.filter((e) => PATTERNS.connectionRefused.test(e.message));
  if (refusals.length >= 2) {
    const service = refusals[0]?.service ?? "unknown";
    signals.push({
      label: "Repeated dependency failure detected",
      description: `Connection refused pattern (${refusals.length}x). Service: ${service}`,
      severity: refusals.some((e) => e.severity === "critical") ? "critical" : "error",
      count: refusals.length,
      service,
    });
  }

  const timeouts = events.filter((e) => PATTERNS.timeout.test(e.message));
  if (timeouts.length >= 2) {
    signals.push({
      label: "Timeout / deadline exceeded",
      description: `Timeout or deadline exceeded (${timeouts.length}x)`,
      severity: "error",
      count: timeouts.length,
    });
  }

  const crashloop = events.filter((e) => PATTERNS.crashloop.test(e.message));
  if (crashloop.length >= 1) {
    signals.push({
      label: "CrashLoop pattern detected",
      description: "Container or process restart loop (CrashLoopBackOff / back-off)",
      severity: "critical",
      count: crashloop.length,
    });
  }

  const scaled = events.filter((e) => PATTERNS.scaledToZero.test(e.message));
  if (scaled.length >= 1) {
    signals.push({
      label: "Scale-to-zero or replica change",
      description: "Deployment/StatefulSet scaled to 0 or replica change",
      severity: "warning",
      count: scaled.length,
    });
  }

  const podDel = events.filter((e) => PATTERNS.podDeleted.test(e.message));
  if (podDel.length >= 1) {
    signals.push({
      label: "Pod deleted / lifecycle event",
      description: "Pod deleted or lifecycle event observed",
      severity: "warning",
      count: podDel.length,
    });
  }

  const retries = events.filter((e) => PATTERNS.retry.test(e.message));
  if (retries.length >= 3) {
    signals.push({
      label: "Repeated retries",
      description: `Retry attempts detected (${retries.length}x)`,
      severity: "warning",
      count: retries.length,
    });
  }

  const throttl = events.filter((e) => PATTERNS.throttl.test(e.message));
  if (throttl.length >= 1) {
    signals.push({
      label: "Throttling / rate limit",
      description: "Throttling or rate limit mentioned",
      severity: "warning",
      count: throttl.length,
    });
  }

  const pool = events.filter((e) => PATTERNS.poolExhausted.test(e.message));
  if (pool.length >= 1) {
    signals.push({
      label: "Connection pool exhausted",
      description: "DB or connection pool exhaustion",
      severity: "critical",
      count: pool.length,
    });
  }

  const auth = events.filter((e) => PATTERNS.authError.test(e.message));
  if (auth.length >= 1) {
    signals.push({
      label: "Auth / token error",
      description: "Authentication or token failure",
      severity: "error",
      count: auth.length,
    });
  }

  const services = new Set(events.map((e) => e.service).filter((s) => s !== "unknown-service"));
  if (signals.length === 0 && events.length > 0) {
    signals.push({
      label: "Log activity detected",
      description: `${events.length} parsed event(s). No strong pattern match.`,
      severity: "info",
      count: events.length,
    });
  }

  return signals;
}

function buildSummary(events: ParsedEvent[], signals: Signal[]): IncidentSummary {
  const services = [...new Set(events.map((e) => e.service).filter((s) => s !== "unknown-service"))];
  if (services.length === 0) services.push("unknown-service");

  const hasRefusal = signals.some((s) => s.label.toLowerCase().includes("dependency failure") || s.label.toLowerCase().includes("connection refused"));
  const hasCrash = signals.some((s) => s.label.toLowerCase().includes("crashloop"));
  const hasScale = signals.some((s) => s.label.toLowerCase().includes("scale") || s.label.toLowerCase().includes("replica"));
  const hasTimeout = signals.some((s) => s.label.toLowerCase().includes("timeout"));
  const hasPool = signals.some((s) => s.label.toLowerCase().includes("pool"));

  let whatHappened: string;
  let likelyRootCause: string;

  if (hasCrash && hasRefusal) {
    whatHappened = `Services (e.g. ${services.slice(0, 2).join(", ")}) experienced connection failures and container restarts. Logs show connection refused and CrashLoopBackOff.`;
    likelyRootCause = "A dependency (e.g. cache or DB) became unavailable, causing application startup failures and Kubernetes restarts.";
  } else if (hasTimeout && events.some((e) => PATTERNS.poolExhausted.test(e.message))) {
    whatHappened = "Timeout and connection pool exhaustion observed. Downstream services likely overloaded or blocked.";
    likelyRootCause = "Connection pool exhaustion or slow downstream caused timeouts and cascading failures.";
  } else if (hasScale || events.some((e) => PATTERNS.podDeleted.test(e.message))) {
    whatHappened = "Pod lifecycle or scaling events detected. One or more workloads may have been scaled down or deleted.";
    likelyRootCause = "Workload scaling or pod deletion led to dependency unavailability or increased error rate.";
  } else if (hasRefusal) {
    whatHappened = `Repeated connection refused errors. Affected services: ${services.slice(0, 3).join(", ")}.`;
    likelyRootCause = "A required dependency (e.g. Redis, DB, or another service) was unreachable.";
  } else if (hasTimeout) {
    whatHappened = "Multiple timeout or deadline-exceeded events. Latency or downstream slowness likely.";
    likelyRootCause = "Downstream timeouts or resource contention caused deadline exceeded and retries.";
  } else {
    whatHappened = `Parsed ${events.length} log event(s) across ${services.length} service(s). Review timeline and signals for details.`;
    likelyRootCause = "Insufficient pattern match for a single root cause. Inspect timeline and signals manually.";
  }

  const confidence = Math.min(98, 70 + signals.length * 4 + (hasCrash && hasRefusal ? 15 : 0));
  const suggestedNextSteps = buildSuggestedSteps(signals, events);

  return {
    whatHappened,
    likelyRootCause,
    confidence,
    impactedServices: services,
    suggestedNextSteps,
  };
}

function buildSuggestedSteps(signals: Signal[], events: ParsedEvent[]): string[] {
  const steps: string[] = [];
  const services = [...new Set(events.map((e) => e.service).filter((s) => s !== "unknown-service"))];

  if (signals.some((s) => /dependency|refused|connection/i.test(s.label))) {
    steps.push("Verify dependency (Redis/DB/upstream) availability and network connectivity.");
    steps.push("Check deployment/StatefulSet events and recent rollout or scale changes.");
  }
  if (signals.some((s) => /crashloop|back-off/i.test(s.label))) {
    steps.push("Review pod events and container restart count; confirm startup probes and dependency order.");
    steps.push("Consider retries or circuit breaker for non-critical dependencies.");
  }
  if (signals.some((s) => /timeout|pool/i.test(s.label))) {
    steps.push("Inspect connection pool metrics and slow query or long-running requests.");
    steps.push("Review timeout and backoff configuration between services.");
  }
  if (signals.some((s) => /scale|replica|pod deleted/i.test(s.label))) {
    steps.push("Confirm why workload was scaled or pod deleted (HPA, manual, controller).");
  }
  if (steps.length === 0) {
    steps.push("Correlate with metrics and other logs for the same time window.");
    steps.push("Search for deployment or config changes shortly before the incident.");
  }
  return steps.slice(0, 5);
}
