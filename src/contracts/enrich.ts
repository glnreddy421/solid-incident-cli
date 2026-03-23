/**
 * AI enrichment request/response contracts (v2).
 * Grounded, evidence-linked payloads for /api/incident/enrich.
 */

import type { IncidentSchema, ReportType } from "./model.js";

export type EnrichPayloadVersion = "2.0";

export interface EnrichMetadata {
  enrichVersion: EnrichPayloadVersion;
  schemaVersion: string;
  incidentId: string;
  generatedAt: string;
  mode: "batch" | "live";
  analysisWindow: { start: string; end: string; durationSeconds?: number };
}

export interface EnrichImpactScope {
  affectedServices: string[];
  suspectedDependencies: string[];
  severity?: string;
  blastRadius?: "none" | "single_service" | "multi_service" | "unknown";
  userJourneyOrPath?: string;
}

export interface EnrichSourceSummary {
  sourceCount: number;
  sourceTypes: string[];
  sourceIds: string[];
  missingExpectedSources: string[];
}

export type FindingClassification = "inferred" | "corroborated" | "strongly_corroborated";
export type FindingKind = "signal" | "pattern" | "correlation" | "severity_spike" | "other";

export interface EnrichFinding {
  findingId: string;
  title: string;
  kind: FindingKind;
  severity: string;
  confidence: number;
  classification: FindingClassification;
  ruleId?: string;
  ruleName?: string;
  summary: string;
  evidenceRefs: string[];
  reasons: string[];
  warnings?: string[];
}

export interface EnrichCausalChain {
  chainId: string;
  title: string;
  classification: string;
  overallConfidence: number;
  probableTrigger?: string;
  orderedSteps: string[];
  involvedServices: string[];
  evidenceRefs: string[];
  warnings?: string[];
}

export interface EnrichRootCauseCandidate {
  candidateId: string;
  label: string;
  confidence: number;
  rank: number;
  supportingEvidenceRefs: string[];
  opposingOrMissingEvidence?: string[];
  basis: string;
}

export interface EnrichEvidence {
  eventId: string;
  sourceId: string;
  sourceType: string;
  timestamp: string;
  service: string;
  hostPodContainer?: string;
  normalizedMessage: string;
  rawExcerpt?: string;
  parserId?: string;
  parseConfidence?: number;
  relatedFindingIds?: string[];
  relatedChainIds?: string[];
  confidence?: number;
  tags?: string[];
}

export interface EnrichRuleDiagnostic {
  ruleId: string;
  ruleName: string;
  matched: boolean;
  reasons: string[];
  confidenceAdjustment?: number;
  evidenceRefs?: string[];
  warnings?: string[];
}

export interface EnrichRecommendedCheckInput {
  checkId: string;
  text: string;
  reason: string;
  targetCandidateId?: string;
  priority: "low" | "medium" | "high";
  supportingEvidenceRefs?: string[];
}

/** Separates ids by epistemic layer for the model (facts vs inferences). */
export interface EnrichLayering {
  observedEventIds: string[];
  heuristicFindingIds: string[];
  causalHypothesisChainIds: string[];
}

export interface EnrichRequest {
  enrichVersion: EnrichPayloadVersion;
  metadata: EnrichMetadata;
  impactScope: EnrichImpactScope;
  sourceSummary: EnrichSourceSummary;
  findings: EnrichFinding[];
  causalChains: EnrichCausalChain[];
  rootCauseCandidates: EnrichRootCauseCandidate[];
  evidence: EnrichEvidence[];
  ruleDiagnostics: EnrichRuleDiagnostic[];
  missingEvidenceAndUncertainty: string[];
  recommendedChecks: EnrichRecommendedCheckInput[];
  layering: EnrichLayering;
  /** Compact legacy schema for backends that only consume timeline/summary. */
  legacySchema: IncidentSchema;
}

export type EnrichResponseVersion = "2.0";

export interface EnrichRankedRootCause {
  label: string;
  confidenceValue?: number;
  confidenceLabel?: string;
  rationale: string;
  supportingEvidenceRefs: string[];
  caveats: string[];
}

export interface EnrichRefinedCheck {
  text: string;
  whyItMatters: string;
  priority: "low" | "medium" | "high";
  linkedCandidateLabel?: string;
}

export interface EnrichResponseV2 {
  enrichResponseVersion: EnrichResponseVersion;
  available: boolean;
  enrichedSummary: string;
  operatorNarrative: string;
  timelineNarrative: string;
  rankedRootCauseCandidates: EnrichRankedRootCause[];
  refinedRecommendedChecks: EnrichRefinedCheck[];
  followUpQuestions: string[];
  caveats: string[];
  confidenceStatement: string;
  reports?: Partial<Record<ReportType, { type: ReportType; title: string; body: string; generatedAt: string }>>;
  warning?: string;
}
