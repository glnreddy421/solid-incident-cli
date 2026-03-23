export const INCIDENT_ENRICHMENT_SCHEMA_VERSION = "incident-enrichment.v1" as const;
export type EnrichmentSchemaVersion = typeof INCIDENT_ENRICHMENT_SCHEMA_VERSION;

export type EnrichmentStyle =
  | "briefing"
  | "rca"
  | "executive"
  | "runbook"
  | "star"
  | "car"
  | "debug"
  | "questions";

export type EnrichmentProviderName = "openai-compatible" | "noop";

export interface IncidentPayloadSource {
  kind: "analysis-result";
  engine?: string;
  engineVersion?: string;
  analysisMode?: string;
}

export interface PayloadTruncationInfo {
  timelineEntriesDropped: number;
  signalsDropped: number;
  candidatesDropped: number;
  excerptsDropped: number;
}

export interface IncidentPayloadMetadata {
  analysisId?: string;
  inputLabel?: string;
  verdict?: string;
  severity?: string;
  confidence?: number;
  healthScore?: number;
  ambiguityFlags: string[];
  truncation: PayloadTruncationInfo;
}

export interface IncidentSummaryPayload {
  title?: string;
  summary?: string;
  verdict?: string;
  severity?: string;
  confidence?: number;
  healthScore?: number;
}

export interface IncidentTrigger {
  timestamp?: string;
  service?: string;
  normalizedType?: string;
  severity?: string;
  message?: string;
  evidence?: string[];
}

export interface RootCauseCandidate {
  rank: number;
  label: string;
  confidence?: number;
  category?: string;
  service?: string;
  reasoning?: string[];
  evidence?: string[];
}

export interface IncidentSignal {
  name: string;
  category?: string;
  count?: number;
  confidence?: number;
  relatedServices?: string[];
  details?: string[];
}

export interface PropagationSummary {
  chain: string[];
  edgeCount?: number;
  confidence?: number;
  notes?: string[];
}

export interface TimelineSummaryEntry {
  timestamp?: string;
  service?: string;
  normalizedType?: string;
  severity?: string;
  message?: string;
  annotation?: string;
}

export interface TrustSummary {
  overall?: number;
  parseCoverage?: number;
  timestampCoverage?: number;
  serviceCoverage?: number;
  severityCoverage?: number;
  evidenceDensity?: number;
  ambiguityFlags: string[];
  notes?: string[];
}

export interface CorrelationSummary {
  hasSnapshot: boolean;
  highlights: string[];
  rulesMatched?: string[];
  crossSourcePropagation?: boolean;
  errorBurstServices?: string[];
}

export interface EvidenceExcerpt {
  kind: "timeline" | "candidate" | "signal" | "correlation";
  service?: string;
  timestamp?: string;
  text: string;
}

export interface IncidentEnrichmentPayload {
  schemaVersion: EnrichmentSchemaVersion;
  generatedAt: string;
  source: IncidentPayloadSource;
  incident: IncidentSummaryPayload;
  trigger?: IncidentTrigger;
  rootCauseCandidates: RootCauseCandidate[];
  affectedServices: string[];
  signals: IncidentSignal[];
  propagation?: PropagationSummary;
  timeline: TimelineSummaryEntry[];
  trust?: TrustSummary;
  suggestedCauses: string[];
  suggestedFixes: string[];
  correlation?: CorrelationSummary;
  evidenceExcerpts: EvidenceExcerpt[];
  metadata: IncidentPayloadMetadata;
}

export interface EnrichmentProviderConfig {
  provider: EnrichmentProviderName;
  url?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  temperature?: number;
  maxTokens?: number;
}

export interface EnrichmentRequest {
  payload: IncidentEnrichmentPayload;
  style: EnrichmentStyle;
  config: EnrichmentProviderConfig;
  prompt: BuiltPrompt;
}

export interface EnrichmentSection {
  title: string;
  body: string;
}

export interface EnrichmentProviderMetadata {
  provider: EnrichmentProviderName;
  model?: string;
  endpoint?: string;
  latencyMs?: number;
}

export interface EnrichmentResult {
  style: EnrichmentStyle;
  provider: EnrichmentProviderMetadata;
  schemaVersion: EnrichmentSchemaVersion;
  generatedAt: string;
  content: string;
  format: "text" | "markdown" | "json";
  sections?: EnrichmentSection[];
}

export interface BuildIncidentPayloadOptions {
  maxTimelineEntries?: number;
  maxSignals?: number;
  maxCandidates?: number;
  maxExcerpts?: number;
  maxStringLength?: number;
  inputLabel?: string;
}

export interface BuiltPrompt {
  systemPrompt: string;
  userPrompt: string;
}

export interface PromptBuildOptions {
  style: EnrichmentStyle;
  payload: IncidentEnrichmentPayload;
  systemPromptOverride?: string;
  userPromptOverride?: string;
  systemPromptFile?: string;
  promptFile?: string;
  /**
   * When set (follow-up pass), user prompt leads with this narrative and still includes structured payload as facts.
   */
  priorNarrativeForFollowUp?: string;
}

export interface EnrichmentProvider {
  readonly name: EnrichmentProviderName;
  enrich(request: EnrichmentRequest): Promise<EnrichmentResult>;
}
