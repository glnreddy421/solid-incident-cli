/**
 * Heuristic mapping of signals and trigger patterns to human-readable
 * suggested causes and fixes. Works without AI backend.
 */

import type { IncidentAssessment, Signal } from "../contracts/index.js";

/** Pattern → human-readable cause */
const CAUSE_PATTERNS: Array<{ pattern: RegExp; cause: string }> = [
  { pattern: /failed to parse CPU|CPU allowed micro secs/i, cause: "Container CPU limits or cgroup parsing issue (common in Docker)" },
  { pattern: /oom|OOMKilled|out of memory|memory pressure/i, cause: "Insufficient memory; process or container hit memory limit" },
  { pattern: /connection refused|dial tcp|connection reset/i, cause: "Upstream service unavailable or not listening" },
  { pattern: /timeout|deadline exceeded|timed out/i, cause: "Request took too long; upstream slow or overloaded" },
  { pattern: /rate.?limit|throttl|429/i, cause: "Rate limiting or throttling in effect" },
  { pattern: /500|502|503|5\d\d/i, cause: "Upstream service returned server error" },
  { pattern: /restart|crashloop|back-?off/i, cause: "Service repeatedly crashing and restarting" },
  { pattern: /database|connection pool|pool exhausted/i, cause: "Database connection exhaustion or connectivity issue" },
  { pattern: /dependency|upstream/i, cause: "Dependency chain failure; one service failed others" },
];

/** Pattern → human-readable fix */
const FIX_PATTERNS: Array<{ pattern: RegExp; fix: string }> = [
  { pattern: /failed to parse CPU|CPU allowed micro secs/i, fix: "Increase Docker CPU allocation (Settings → Resources) or run without container limits" },
  { pattern: /oom|OOMKilled|out of memory/i, fix: "Increase memory limit, reduce model size, or add swap" },
  { pattern: /connection refused|dial tcp/i, fix: "Verify upstream is running and reachable; check network/firewall" },
  { pattern: /timeout|deadline exceeded/i, fix: "Increase timeout, scale up upstream, or reduce load" },
  { pattern: /rate.?limit|throttl|429/i, fix: "Back off and retry; increase rate limits if you control the API" },
  { pattern: /500|502|503/i, fix: "Check upstream logs; may need restart or config fix" },
  { pattern: /restart|crashloop/i, fix: "Inspect crash logs; fix config or resource limits; consider health checks" },
  { pattern: /database|pool exhausted/i, fix: "Increase pool size, fix connection leaks, or scale database" },
  { pattern: /dependency/i, fix: "Restart failed dependency first; verify deployment order" },
];

/** Signal label → cause hint */
const SIGNAL_CAUSES: Record<string, string> = {
  rate_limit_exhaustion: "API or service rate limits exceeded",
  connection_refused_pattern: "Target service not accepting connections",
  dependency_failure_chain: "Cascading failure from a downstream dependency",
  timeout_pattern: "Requests timing out",
  restart_detected: "Service restarts detected",
  memory_pressure_pattern: "Memory pressure or OOM risk",
  database_connection_refused: "Database unreachable",
  service_restart_loop: "Service in crash-restart loop",
};

/** Signal label → fix hint */
const SIGNAL_FIXES: Record<string, string> = {
  rate_limit_exhaustion: "Add retries with backoff; increase limits if possible",
  connection_refused_pattern: "Ensure target service is running and listening",
  dependency_failure_chain: "Restart root-cause service first; check dependency health",
  timeout_pattern: "Increase timeouts or optimize slow operations",
  restart_detected: "Check logs for crash reason; fix config or resources",
  memory_pressure_pattern: "Increase memory; reduce concurrency or model size",
  database_connection_refused: "Verify DB is up; check credentials and network",
  service_restart_loop: "Fix underlying crash; add resource limits or health checks",
};

export function deriveSuggestedCauses(assessment: IncidentAssessment, signals: Signal[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const trigger = assessment.triggerEvent ?? "";
  for (const { pattern, cause } of CAUSE_PATTERNS) {
    if (pattern.test(trigger) && cause && !seen.has(cause)) {
      seen.add(cause);
      out.push(cause);
    }
  }

  for (const s of signals) {
    const hint = SIGNAL_CAUSES[s.label];
    if (hint && !seen.has(hint)) {
      seen.add(hint);
      out.push(hint);
    }
  }

  for (const r of assessment.rootCauseCandidates) {
    const ev = r.evidence ?? r.label ?? "";
    for (const { pattern, cause } of CAUSE_PATTERNS) {
      if (pattern.test(ev) && cause && !seen.has(cause)) {
        seen.add(cause);
        out.push(cause);
      }
    }
  }

  return out.slice(0, 6);
}

export function deriveSuggestedFixes(assessment: IncidentAssessment, signals: Signal[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const trigger = assessment.triggerEvent ?? "";
  for (const { pattern, fix } of FIX_PATTERNS) {
    if (pattern.test(trigger) && fix && !seen.has(fix)) {
      seen.add(fix);
      out.push(fix);
    }
  }

  for (const s of signals) {
    const hint = SIGNAL_FIXES[s.label];
    if (hint && !seen.has(hint)) {
      seen.add(hint);
      out.push(hint);
    }
  }

  for (const r of assessment.rootCauseCandidates) {
    const ev = r.evidence ?? r.label ?? "";
    for (const { pattern, fix } of FIX_PATTERNS) {
      if (pattern.test(ev) && fix && !seen.has(fix)) {
        seen.add(fix);
        out.push(fix);
      }
    }
  }

  const fromActions = assessment.recommendedActions.filter((a) => !seen.has(a));
  for (const a of fromActions.slice(0, 3)) {
    out.push(a);
  }

  return out.slice(0, 6);
}

function sanitizeTriggerForDisplay(trigger: string): string {
  const cleaned = trigger.replace(/\\"/g, '"').trim();
  if (/parsing\s+["']?\\?["']?\w+["']?\\?["']?\s*:\s*invalid syntax/i.test(cleaned)) {
    return "cgroup/resource parse error (e.g. CPU limit)";
  }
  return cleaned;
}

export function deriveHumanExplanation(
  assessment: IncidentAssessment,
  suggestedCauses: string[],
  suggestedFixes: string[]
): string {
  const verdict = assessment.verdict;
  const severity = assessment.severity;
  const triggerRaw = assessment.triggerEvent ?? "";
  const trigger = triggerRaw ? ` (trigger: ${sanitizeTriggerForDisplay(triggerRaw)})` : "";
  const services = assessment.serviceCount;

  let intro = "";
  if (verdict === "NO INCIDENT") {
    intro = `No incident detected. ${assessment.summaryNarrative}`;
  } else if (verdict === "POSSIBLE DEGRADATION") {
    intro = `Possible degradation across ${services} service(s)${trigger}. Warnings or anomalies were detected.`;
  } else if (verdict === "INCIDENT DETECTED") {
    intro = `Incident detected across ${services} service(s)${trigger}. Failure patterns and propagation indicate active issues.`;
  } else {
    intro = `Insufficient evidence for a clear verdict. ${assessment.summaryNarrative}`;
  }

  const causesPart =
    suggestedCauses.length > 0
      ? ` Likely causes: ${suggestedCauses.slice(0, 3).join("; ")}.`
      : "";
  const fixesPart =
    suggestedFixes.length > 0
      ? ` Suggested next steps: ${suggestedFixes.slice(0, 3).join("; ")}.`
      : "";

  return `${intro}${causesPart}${fixesPart}`;
}
