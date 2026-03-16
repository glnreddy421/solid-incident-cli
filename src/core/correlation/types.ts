import type { CanonicalEvent } from "../../utils/inputAdapters/types.js";

/**
 * EvidenceRef links correlation outputs to canonical events.
 * Correlation rules should always provide explainable event references.
 */
export interface EvidenceRef {
  eventId: string;
  sourceId?: string;
  service?: string;
  timestamp?: string;
  explanation?: string;
}

export interface CorrelatedGroup {
  /** Backward-compatible identifier */
  id: string;
  /** Strict contract identifier */
  groupId: string;
  key: string;
  eventIds: string[];
  relatedEventIds: string[];
  services: string[];
  sourceIds: string[];
  firstSeen: string;
  lastSeen: string;
  timeWindow: {
    start: string;
    end: string;
  };
  groupingReasons: string[];
  confidence: number;
}

export interface CausalChainStep {
  /** Backward-compatible label */
  label: string;
  /** Strict contract label */
  description: string;
  eventIds: string[];
  evidenceRefs: EvidenceRef[];
  service?: string;
  sourceIds: string[];
}

export interface CausalChain {
  /** Backward-compatible identifier */
  id: string;
  /** Strict contract identifier */
  chainId: string;
  probableTrigger?: EvidenceRef;
  /** Backward-compatible field */
  steps: CausalChainStep[];
  /** Strict contract field */
  orderedSteps: CausalChainStep[];
  eventIds: string[];
  evidenceRefs: EvidenceRef[];
  involvedServices: string[];
  sourceIds: string[];
  evidenceSources: string[];
  /** Backward-compatible field */
  confidence: number;
  /** Strict contract field */
  overallConfidence: number;
  corroboration: "single-source-inferred" | "multi-source-corroborated";
  strength: "single-source-inferred" | "multi-source-corroborated" | "high-confidence-cross-source";
  reasons: string[];
  ruleId?: string;
  ruleName?: string;
  ruleDiagnostics?: {
    reasonsTriggered: string[];
    confidenceAdjustments?: string[];
    evidenceEventIds: string[];
  };
  warnings?: string[];
}

export interface Finding {
  /** Backward-compatible identifier */
  id: string;
  /** Strict contract identifier */
  findingId: string;
  key: string;
  title: string;
  /** Backward-compatible description */
  summary: string;
  /** Strict contract description */
  description: string;
  severity: "info" | "warning" | "error" | "critical";
  /** Backward-compatible field */
  confidence: number;
  /** Strict contract field */
  overallConfidence: number;
  /** Backward-compatible field */
  evidence: EvidenceRef[];
  /** Strict contract field */
  evidenceRefs: EvidenceRef[];
  services: string[];
  sourceIds: string[];
  corroboration: "single-source-inferred" | "multi-source-corroborated";
  strength: "single-source-inferred" | "multi-source-corroborated" | "high-confidence-cross-source";
  reasons: string[];
  ruleId?: string;
  ruleName?: string;
  ruleDiagnostics?: {
    reasonsTriggered: string[];
    confidenceAdjustments?: string[];
    evidenceEventIds: string[];
  };
  warnings?: string[];
}

export interface ActiveFinding extends Finding {
  activeSince: string;
  updatedAt: string;
}

export interface ConfidenceSummary {
  overall: number;
  sourceDiversity: number;
  temporalCoherence: number;
  linkageQuality: number;
  ambiguityPenalty: number;
}

export interface RollingWindowSnapshot {
  windowMs: number;
  windowStart: string;
  windowEnd: string;
  totalEvents: number;
  sourceCount: number;
  serviceCount: number;
  events: CanonicalEvent[];
}

/**
 * CorrelationResult is the strict output contract for rolling correlation.
 * Backward-compatible aliases are preserved to avoid breaking existing TUI/engine consumers.
 */
export interface CorrelationResult {
  /** Backward-compatible field */
  timeline: CanonicalEvent[];
  /** Strict contract field */
  mergedTimeline: CanonicalEvent[];
  correlatedGroups: CorrelatedGroup[];
  findings: Finding[];
  /** Backward-compatible field */
  activeFindings: ActiveFinding[];
  /** Backward-compatible field */
  activeChains: CausalChain[];
  /** Strict contract field */
  causalChains: CausalChain[];
  confidenceSummary: ConfidenceSummary;
  snapshot: RollingWindowSnapshot;
  diagnostics: {
    ruleHits: Record<string, number>;
    ruleExecutionOrder: string[];
    findingsByRule: Record<string, string[]>;
    chainsByRule: Record<string, string[]>;
  };
}

