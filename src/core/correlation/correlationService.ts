import type { CanonicalEvent } from "../../utils/inputAdapters/types.js";
import { groupCorrelatedEvents } from "./grouping.js";
import { classifyStrength, scoreConfidence } from "./confidence.js";
import { RollingEventWindow } from "./rollingWindow.js";
import { getCorrelationRules } from "./rules.js";
import type { ActiveFinding, ConfidenceSummary, CorrelatedGroup, CorrelationResult, Finding, RollingWindowSnapshot } from "./types.js";
import { eventTime } from "./utils.js";

function toActive(findings: Finding[]): ActiveFinding[] {
  const now = new Date().toISOString();
  return findings.map((finding) => ({
    ...finding,
    activeSince: finding.evidence[0]?.timestamp ?? now,
    updatedAt: now,
  }));
}

function confidenceSummary(
  events: CanonicalEvent[],
  findings: Finding[],
  groups: CorrelatedGroup[],
): ConfidenceSummary {
  const scored = scoreConfidence({
    events,
    base: findings.length > 0 ? 0.22 : 0.12,
    ambiguityPenalty: events.length > 0 && findings.length === 0 ? 0.24 : 0.08,
    conflictPenalty: groups.length > 0 ? 0.03 : 0.06,
  });
  return {
    overall: scored.confidence,
    sourceDiversity: scored.sourceDiversity,
    temporalCoherence: scored.timeAlignment,
    linkageQuality: scored.linkageQuality,
    ambiguityPenalty: scored.ambiguityPenalty,
  };
}

export class CorrelationService {
  private readonly window: RollingEventWindow;

  constructor(windowMs = 5 * 60 * 1000, maxEvents = 5000) {
    this.window = new RollingEventWindow(windowMs, maxEvents);
  }

  ingest(event: CanonicalEvent): CorrelationResult {
    this.window.add(event);
    return this.getSnapshot();
  }

  getSnapshot(): CorrelationResult {
    const events = this.window.getAll().sort((a, b) => eventTime(a) - eventTime(b));
    const groups = groupCorrelatedEvents(events);
    const rules = getCorrelationRules();
    const diagnostics: CorrelationResult["diagnostics"] = {
      ruleHits: {},
      ruleExecutionOrder: rules.map((rule) => rule.id),
      findingsByRule: {},
      chainsByRule: {},
    };
    const chains: CorrelationResult["activeChains"] = [];
    const findings: Finding[] = [];
    for (const rule of rules) {
      const out = rule.run(events);
      const producedFindings = (out.findings ?? []).map((finding) => ({
        ...finding,
        findingId: finding.findingId ?? finding.id,
        description: finding.description ?? finding.summary,
        overallConfidence: finding.overallConfidence ?? finding.confidence,
        evidenceRefs: finding.evidenceRefs ?? finding.evidence,
        ruleId: finding.ruleId ?? rule.id,
        ruleName: finding.ruleName ?? out.ruleName ?? rule.name ?? rule.id,
        ruleDiagnostics: finding.ruleDiagnostics ?? {
          reasonsTriggered: finding.reasons,
          confidenceAdjustments: [],
          evidenceEventIds: (finding.evidenceRefs ?? finding.evidence).map((e) => e.eventId),
        },
      }));
      const producedChains = (out.chains ?? []).map((chain) => ({
        ...chain,
        chainId: chain.chainId ?? chain.id,
        orderedSteps: chain.orderedSteps ?? chain.steps,
        evidenceRefs: chain.evidenceRefs ?? chain.eventIds.map((id) => ({ eventId: id })),
        evidenceSources: chain.evidenceSources ?? chain.sourceIds,
        overallConfidence: chain.overallConfidence ?? chain.confidence,
        ruleId: chain.ruleId ?? rule.id,
        ruleName: chain.ruleName ?? out.ruleName ?? rule.name ?? rule.id,
        ruleDiagnostics: chain.ruleDiagnostics ?? {
          reasonsTriggered: chain.reasons,
          confidenceAdjustments: [],
          evidenceEventIds: chain.eventIds,
        },
      }));
      diagnostics.ruleHits[rule.id] = producedFindings.length + producedChains.length;
      diagnostics.findingsByRule[rule.id] = producedFindings.map((finding) => finding.id);
      diagnostics.chainsByRule[rule.id] = producedChains.map((chain) => chain.id);
      chains.push(...producedChains);
      findings.push(...producedFindings);
    }
    findings.push(...chains.map((chain) => ({
        id: `finding-${chain.id}`,
        findingId: `finding-${chain.id}`,
        key: `causal_chain:${chain.id}`,
        title: "Probable causal chain active",
        summary: `Observed ${chain.steps.map((s) => s.label).join(" -> ")}.`,
        description: `Observed ${chain.steps.map((s) => s.label).join(" -> ")}.`,
        severity: chain.strength === "high-confidence-cross-source"
          ? "critical" as const
          : chain.corroboration === "multi-source-corroborated"
            ? "error" as const
            : "warning" as const,
        confidence: chain.confidence,
        overallConfidence: chain.confidence,
        evidence: chain.eventIds.map((id) => ({ eventId: id, explanation: "event contributes to causal chain" })),
        evidenceRefs: chain.eventIds.map((id) => ({ eventId: id, explanation: "event contributes to causal chain" })),
        services: chain.involvedServices,
        sourceIds: chain.sourceIds,
        corroboration: chain.corroboration,
        strength: chain.strength,
        reasons: chain.reasons,
        ruleId: chain.ruleId ?? "derived-causal-chain-finding",
        ruleName: chain.ruleName ?? "Derived Causal Chain",
        ruleDiagnostics: chain.ruleDiagnostics ?? {
          reasonsTriggered: chain.reasons,
          confidenceAdjustments: [],
          evidenceEventIds: chain.eventIds,
        },
        warnings: chain.warnings,
      })));
    findings.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return a.id.localeCompare(b.id);
    });
    const activeFindings = toActive(findings);
    const windowEvents = events;
    const snapshot: RollingWindowSnapshot = {
      windowMs: this.window.getWindowMs(),
      windowStart: windowEvents[0]?.timestamp ?? windowEvents[0]?.receivedAt ?? new Date().toISOString(),
      windowEnd: windowEvents[windowEvents.length - 1]?.timestamp ?? windowEvents[windowEvents.length - 1]?.receivedAt ?? new Date().toISOString(),
      totalEvents: windowEvents.length,
      sourceCount: new Set(windowEvents.map((e) => e.sourceId).filter(Boolean)).size,
      serviceCount: new Set(windowEvents.map((e) => e.service).filter(Boolean)).size,
      events: windowEvents,
    };
    return {
      timeline: events,
      mergedTimeline: events,
      correlatedGroups: groups,
      findings,
      activeFindings,
      activeChains: chains,
      causalChains: chains,
      confidenceSummary: confidenceSummary(events, findings, groups),
      snapshot,
      diagnostics,
    };
  }
}

