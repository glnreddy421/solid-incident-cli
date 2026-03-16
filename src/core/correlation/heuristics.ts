import type { CanonicalEvent } from "../../utils/inputAdapters/types.js";
import type { CausalChain, Finding } from "./types.js";
import { classifyStrength, scoreConfidence } from "./confidence.js";
import { corroborationFor, eventIdOf, eventTime, toEvidence } from "./utils.js";

const RETRY_RE = /retry|backoff|attempt/i;
const TIMEOUT_RE = /timeout|deadline exceeded|timed out/i;
const FAILURE_RE = /error|failed|exception|5\d\d|connection refused|unavailable/i;
const USER_RE = /user|request|client|frontend|gateway|api/i;
const CONNECTION_RE = /connection refused|econnrefused|connect failed|socket hang up|connection reset|network unreachable/i;

export function detectTimeoutRetryFailureChains(events: CanonicalEvent[]): CausalChain[] {
  const byService = new Map<string, CanonicalEvent[]>();
  for (const event of events) {
    const service = event.service ?? "unknown-service";
    if (!byService.has(service)) byService.set(service, []);
    byService.get(service)!.push(event);
  }

  const chains: CausalChain[] = [];
  for (const [service, serviceEvents] of byService.entries()) {
    const timeouts = serviceEvents.filter((event) => TIMEOUT_RE.test(event.message ?? ""));
    const retries = serviceEvents.filter((event) => RETRY_RE.test(event.message ?? ""));
    const failures = serviceEvents.filter((event) => FAILURE_RE.test(event.message ?? ""));
    if (timeouts.length === 0 || retries.length === 0 || failures.length === 0) continue;

    const ordered = [timeouts[0], retries[0], failures[0]].sort((a, b) => eventTime(a) - eventTime(b));
    const sourceIds = [...new Set(ordered.map((e) => e.sourceId).filter(Boolean) as string[])];
    const corroboration = corroborationFor(sourceIds);
    const scored = scoreConfidence({
      events: [...timeouts.slice(-3), ...retries.slice(-3), ...failures.slice(-3)],
      base: 0.28,
      ambiguityPenalty: corroboration === "multi-source-corroborated" ? 0.07 : 0.14,
    });
    const strength = classifyStrength(scored.confidence, sourceIds.length);
    const evidenceRefs = toEvidence([...timeouts.slice(-3), ...retries.slice(-3), ...failures.slice(-3)]);
    const stepTimeoutIds = timeouts.map((e) => eventIdOf(e));
    const stepRetryIds = retries.map((e) => eventIdOf(e));
    const stepFailureIds = failures.map((e) => eventIdOf(e));
    chains.push({
      id: `chain-timeout-retry-failure-${service}`,
      chainId: `chain-timeout-retry-failure-${service}`,
      probableTrigger: {
        eventId: eventIdOf(ordered[0]),
        sourceId: ordered[0].sourceId,
        service,
        timestamp: ordered[0].timestamp ?? ordered[0].receivedAt,
      },
      steps: [
        {
          label: "timeout pattern",
          description: "Timeout signals observed.",
          eventIds: stepTimeoutIds,
          evidenceRefs: toEvidence(timeouts),
          service,
          sourceIds: [...new Set(timeouts.map((e) => e.sourceId).filter(Boolean) as string[])],
        },
        {
          label: "retry escalation",
          description: "Retry/backoff behavior escalated.",
          eventIds: stepRetryIds,
          evidenceRefs: toEvidence(retries),
          service,
          sourceIds: [...new Set(retries.map((e) => e.sourceId).filter(Boolean) as string[])],
        },
        {
          label: "failure outcome",
          description: "Final failure outcome observed.",
          eventIds: stepFailureIds,
          evidenceRefs: toEvidence(failures),
          service,
          sourceIds: [...new Set(failures.map((e) => e.sourceId).filter(Boolean) as string[])],
        },
      ],
      orderedSteps: [
        {
          label: "timeout pattern",
          description: "Timeout signals observed.",
          eventIds: stepTimeoutIds,
          evidenceRefs: toEvidence(timeouts),
          service,
          sourceIds: [...new Set(timeouts.map((e) => e.sourceId).filter(Boolean) as string[])],
        },
        {
          label: "retry escalation",
          description: "Retry/backoff behavior escalated.",
          eventIds: stepRetryIds,
          evidenceRefs: toEvidence(retries),
          service,
          sourceIds: [...new Set(retries.map((e) => e.sourceId).filter(Boolean) as string[])],
        },
        {
          label: "failure outcome",
          description: "Final failure outcome observed.",
          eventIds: stepFailureIds,
          evidenceRefs: toEvidence(failures),
          service,
          sourceIds: [...new Set(failures.map((e) => e.sourceId).filter(Boolean) as string[])],
        },
      ],
      eventIds: [...new Set([...timeouts, ...retries, ...failures].map((e) => eventIdOf(e)))],
      evidenceRefs,
      involvedServices: [service],
      sourceIds,
      evidenceSources: sourceIds,
      confidence: scored.confidence,
      overallConfidence: scored.confidence,
      corroboration,
      strength,
      reasons: [
        `${timeouts.length} timeout-like events`,
        `${retries.length} retry-like events`,
        `${failures.length} failure-like events`,
      ],
      ruleId: "timeout-retry-failure-chain",
      ruleName: "Timeout -> Retry -> Failure",
      ruleDiagnostics: {
        reasonsTriggered: [
          `${timeouts.length} timeout-like events`,
          `${retries.length} retry-like events`,
          `${failures.length} failure-like events`,
        ],
        evidenceEventIds: [...new Set([...timeouts, ...retries, ...failures].map((e) => eventIdOf(e)))],
      },
      warnings: corroboration === "single-source-inferred"
        ? ["Single source evidence only.", "Treat as probable chain until corroborated."]
        : undefined,
    });
  }
  return chains;
}

export function detectErrorBurstFindings(events: CanonicalEvent[]): Finding[] {
  const windowByService = new Map<string, CanonicalEvent[]>();
  for (const event of events) {
    if (!FAILURE_RE.test(event.message ?? "") && !["error", "critical"].includes((event.level ?? "").toLowerCase())) continue;
    const service = event.service ?? "unknown-service";
    if (!windowByService.has(service)) windowByService.set(service, []);
    windowByService.get(service)!.push(event);
  }
  const findings: Finding[] = [];
  for (const [service, serviceEvents] of windowByService.entries()) {
    if (serviceEvents.length < 3) continue;
    const sourceIds = [...new Set(serviceEvents.map((e) => e.sourceId).filter(Boolean) as string[])];
    const corroboration = corroborationFor(sourceIds);
    const scored = scoreConfidence({
      events: serviceEvents,
      base: 0.24,
      ambiguityPenalty: corroboration === "multi-source-corroborated" ? 0.08 : 0.15,
    });
    const strength = classifyStrength(scored.confidence, sourceIds.length);
    const evidenceRefs = toEvidence(serviceEvents.slice(-8));
    findings.push({
      id: `finding-error-burst-${service}`,
      findingId: `finding-error-burst-${service}`,
      key: `error_burst:${service}`,
      title: "Error burst detected",
      summary: `${serviceEvents.length} failure-like events observed for ${service}.`,
      description: `${serviceEvents.length} failure-like events observed for ${service}.`,
      severity: serviceEvents.length >= 6 ? "critical" : "error",
      confidence: scored.confidence,
      overallConfidence: scored.confidence,
      evidence: evidenceRefs,
      evidenceRefs,
      services: [service],
      sourceIds,
      corroboration,
      strength,
      reasons: [
        `${serviceEvents.length} events in current window`,
        `service=${service}`,
      ],
      ruleId: "error-burst",
      ruleName: "Repeated Error Burst",
      ruleDiagnostics: {
        reasonsTriggered: [
          `${serviceEvents.length} events in current window`,
          `service=${service}`,
        ],
        evidenceEventIds: evidenceRefs.map((e) => e.eventId),
      },
      warnings: corroboration === "single-source-inferred" ? ["Cross-source corroboration not observed."] : undefined,
    });
  }
  return findings;
}

export function detectCrossSourcePropagationFindings(events: CanonicalEvent[]): Finding[] {
  const failures = events.filter((event) => FAILURE_RE.test(event.message ?? ""));
  if (failures.length < 2) return [];
  const byMinute = new Map<string, CanonicalEvent[]>();
  for (const event of failures) {
    const ts = new Date(event.timestamp ?? event.receivedAt ?? Date.now()).toISOString().slice(0, 16);
    if (!byMinute.has(ts)) byMinute.set(ts, []);
    byMinute.get(ts)!.push(event);
  }
  const findings: Finding[] = [];
  for (const [minute, bucket] of byMinute.entries()) {
    const sources = [...new Set(bucket.map((e) => e.sourceId).filter(Boolean) as string[])];
    const services = [...new Set(bucket.map((e) => e.service).filter(Boolean) as string[])];
    if (sources.length < 2 || services.length < 2) continue;
    const scored = scoreConfidence({
      events: bucket,
      base: 0.34,
      ambiguityPenalty: 0.06,
    });
    const strength = classifyStrength(scored.confidence, sources.length);
    const evidenceRefs = toEvidence(bucket.slice(0, 10));
    findings.push({
      id: `finding-cross-source-${minute}`,
      findingId: `finding-cross-source-${minute}`,
      key: `cross_source_failure:${minute}`,
      title: "Cross-source failure propagation suspected",
      summary: `Concurrent failure signals across ${services.length} services and ${sources.length} sources.`,
      description: `Concurrent failure signals across ${services.length} services and ${sources.length} sources.`,
      severity: "critical",
      confidence: scored.confidence,
      overallConfidence: scored.confidence,
      evidence: evidenceRefs,
      evidenceRefs,
      services,
      sourceIds: sources,
      corroboration: "multi-source-corroborated",
      strength,
      reasons: [
        `shared window=${minute}`,
        `${services.length} services`,
        `${sources.length} corroborating sources`,
      ],
      ruleId: "cross-source-propagation",
      ruleName: "Cross-Source Propagation",
      ruleDiagnostics: {
        reasonsTriggered: [
          `shared window=${minute}`,
          `${services.length} services`,
          `${sources.length} corroborating sources`,
        ],
        evidenceEventIds: evidenceRefs.map((e) => e.eventId),
      },
    });
  }
  return findings;
}

export function detectUserVisibleBackendCorroboration(events: CanonicalEvent[]): Finding[] {
  const backendFailures = events.filter((event) => FAILURE_RE.test(event.message ?? "") && !USER_RE.test(event.service ?? ""));
  const userFailures = events.filter((event) => FAILURE_RE.test(event.message ?? "") && USER_RE.test(`${event.service ?? ""} ${event.message ?? ""}`));
  if (backendFailures.length === 0 || userFailures.length === 0) return [];
  const merged = [...backendFailures.slice(-6), ...userFailures.slice(-6)].sort((a, b) => eventTime(a) - eventTime(b));
  const sourceIds = [...new Set(merged.map((e) => e.sourceId).filter(Boolean) as string[])];
  const services = [...new Set(merged.map((e) => e.service).filter(Boolean) as string[])];
  const corroboration = corroborationFor(sourceIds);
  const scored = scoreConfidence({ events: merged, base: 0.3, ambiguityPenalty: 0.09 });
  const evidenceRefs = toEvidence(merged);
  const strength = classifyStrength(scored.confidence, sourceIds.length);
  return [{
    id: "finding-user-visible-corroboration",
    findingId: "finding-user-visible-corroboration",
    key: "user_visible_backend_corroboration",
    title: "User-visible failures corroborated by backend errors",
    summary: "Frontend/gateway failures align with backend failure signals in the same window.",
    description: "Frontend/gateway failures align with backend failure signals in the same window.",
    severity: "critical",
    confidence: scored.confidence,
    overallConfidence: scored.confidence,
    evidence: evidenceRefs,
    evidenceRefs,
    services,
    sourceIds,
    corroboration,
    strength,
    reasons: [
      `${backendFailures.length} backend failures`,
      `${userFailures.length} user-visible failures`,
      "temporal overlap in rolling window",
    ],
    ruleId: "user-visible-backend-corroboration",
    ruleName: "User-visible + Backend Corroboration",
    ruleDiagnostics: {
      reasonsTriggered: [
        `${backendFailures.length} backend failures`,
        `${userFailures.length} user-visible failures`,
        "temporal overlap in rolling window",
      ],
      evidenceEventIds: evidenceRefs.map((e) => e.eventId),
    },
    warnings: corroboration === "single-source-inferred" ? ["Signals are from a single source stream."] : undefined,
  }];
}

export function detectConnectionFailureClusters(events: CanonicalEvent[]): Finding[] {
  const relevant = events.filter((event) => CONNECTION_RE.test(event.message ?? ""));
  const groups = new Map<string, CanonicalEvent[]>();
  for (const event of relevant) {
    const key = `${event.service ?? "unknown-service"}::${event.host ?? "unknown-host"}::${event.url ?? event.dstIp ?? "unknown-dst"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(event);
  }
  const findings: Finding[] = [];
  for (const [key, bucket] of groups.entries()) {
    if (bucket.length < 3) continue;
    const sourceIds = [...new Set(bucket.map((e) => e.sourceId).filter(Boolean) as string[])];
    const services = [...new Set(bucket.map((e) => e.service).filter(Boolean) as string[])];
    const corroboration = corroborationFor(sourceIds);
    const scored = scoreConfidence({ events: bucket, base: 0.26, ambiguityPenalty: corroboration === "multi-source-corroborated" ? 0.07 : 0.12 });
    const evidenceRefs = toEvidence(bucket.slice(-8));
    const strength = classifyStrength(scored.confidence, sourceIds.length);
    findings.push({
      id: `finding-connection-cluster-${key.replace(/[^a-zA-Z0-9]+/g, "-")}`,
      findingId: `finding-connection-cluster-${key.replace(/[^a-zA-Z0-9]+/g, "-")}`,
      key: `connection_cluster:${key}`,
      title: "Repeated connection-related failures",
      summary: `${bucket.length} connection-related failures in correlated identity group.`,
      description: `${bucket.length} connection-related failures in correlated identity group.`,
      severity: bucket.length >= 6 ? "critical" : "error",
      confidence: scored.confidence,
      overallConfidence: scored.confidence,
      evidence: evidenceRefs,
      evidenceRefs,
      services,
      sourceIds,
      corroboration,
      strength,
      reasons: [
        `${bucket.length} connection failure messages`,
        `identity group=${key}`,
      ],
      ruleId: "connection-failure-cluster",
      ruleName: "Connection Failure Cluster",
      ruleDiagnostics: {
        reasonsTriggered: [
          `${bucket.length} connection failure messages`,
          `identity group=${key}`,
        ],
        evidenceEventIds: evidenceRefs.map((e) => e.eventId),
      },
      warnings: corroboration === "single-source-inferred" ? ["Single source; cross-source propagation not confirmed."] : undefined,
    });
  }
  return findings;
}

