export type AppMode = "tui" | "text" | "json" | "markdown" | "html";

export type ReportType = "incident" | "rca" | "interview-story";

export type Severity = "critical" | "error" | "warning" | "info" | "debug";
export type IncidentVerdict = "NO INCIDENT" | "POSSIBLE DEGRADATION" | "INCIDENT DETECTED" | "INSUFFICIENT EVIDENCE";
export type IncidentSeverity = "none" | "low" | "medium" | "high" | "critical";
export type TriggerClassification =
  | "routine_telemetry"
  | "anomaly"
  | "warning_pattern"
  | "failure_pattern"
  | "dependency_failure"
  | "restart_event"
  | "timeout_pattern"
  | "latency_outlier"
  | "connection_refused_pattern"
  | "unknown";
export type TriggerImpact = "none" | "low" | "medium" | "high" | "critical";

export interface InputSource {
  kind: "file" | "stdin";
  name: string;
}

export interface RawLogLine {
  line: string;
  lineNumber: number;
  source?: "file" | "stdin";
  sourceName?: string;
}

export interface TerminalCapabilities {
  stdinIsTty: boolean;
  stdoutIsTty: boolean;
  interactive: boolean;
  isCi: boolean;
  term: string | undefined;
  supportsAnsi: boolean;
}

export interface AnalyzeFlags {
  tui?: boolean;
  noTui?: boolean;
  live?: boolean;
  json?: boolean;
  text?: boolean;
  md?: boolean;
  html?: boolean;
  inspect?: boolean;
  interval?: number;
  hideHeader?: boolean;
  skipSplash?: boolean;
  logLevel?: "error" | "warn" | "info" | "debug";
  report?: boolean;
  rca?: boolean;
  interviewStory?: boolean;
  save?: boolean;
  sessionName?: string;
  verbose?: boolean;
  noAi?: boolean;
  finalize?: boolean;
}

export interface TimelineEntry {
  id: string;
  timestamp: string;
  service: string;
  host?: string;
  pid?: string;
  severity: Severity;
  message: string;
  lineNumber?: number;
  anomaly: boolean;
  isTrigger: boolean;
}

export interface FlowEdge {
  from: string;
  to: string;
  count: number;
  confidence: number;
}

/** Inferred failure propagation edge: who triggered → who reacted → what happened */
export interface TraceGraphEdge {
  from: string;
  to: string;
  /** Short label for propagation event: "connection timeout", "retry storm", "5xx spike" */
  annotation: string;
  count: number;
  confidence: number;
  /** Heuristic score 0–1 from pattern strength, anomaly density, timing */
  heuristicScore?: number;
  /** ML anomaly score 0–1 when engine runs ML */
  mlScore?: number;
  /** Key pattern/signal IDs that support this edge */
  keySignals?: string[];
  /** Optional propagation explanation for this edge */
  transitionReason?: string;
  /** Temporal confidence 0-1 for adjacency/correlation certainty */
  temporalConfidence?: number;
}

/** Trigger candidate for root cause */
export interface TriggerCandidate {
  service: string;
  event: string;
  confidence: number;
}

/** ML enrichment result from engine (K-means anomaly scoring) */
export interface MlEnrichment {
  eventScores: number[];
  clusters: number[];
  modelType: string;
  available: boolean;
}

/** Inferred failure propagation graph: services + events + dependencies + time */
export interface TraceGraph {
  nodes: string[];
  edges: TraceGraphEdge[];
  triggerCandidates: TriggerCandidate[];
  /** Signals that apply to each node (service -> signal labels) */
  nodeSignals?: Record<string, string[]>;
  /** Whether edges were inferred from sequence vs observed transitions */
  inferredFromSequence?: boolean;
}

export interface Signal {
  label: string;
  description?: string;
  severity: Severity;
  count?: number;
  service?: string;
  score?: number;
  /** ML anomaly score 0–1 when engine runs ML */
  mlScore?: number;
  /** Score source: "ml" = K-means anomaly, "tfidf" = TF-IDF cluster rarity */
  scoreSource?: "ml" | "tfidf";
}

export interface IncidentSummary {
  incidentSummary: string;
  triggerEvent: string;
  confidence: number;
  affectedServices: string[];
  incidentWindow: {
    start: string;
    end: string;
  };
}

export interface EventDistribution {
  info: number;
  warn: number;
  error: number;
  anomaly: number;
}

export interface IncidentAssessment {
  verdict: IncidentVerdict;
  severity: IncidentSeverity;
  healthScore: number;
  verdictReason: string;
  triggerClassification: TriggerClassification;
  triggerImpact: TriggerImpact;
  triggerService: string;
  triggerEvent: string;
  triggerPid?: string;
  triggerHost?: string;
  triggerTimestamp: string;
  primaryService: string;
  serviceCount: number;
  anomalyCount: number;
  eventDistribution: EventDistribution;
  systemHealthSummary: string[];
  strongestSignals: string[];
  rootCauseCandidates: Array<{
    id: string;
    label?: string;
    confidence: number;
    weightedScore?: number;
    scoreBreakdown?: {
      heuristicScore: number;
      topologyScore: number;
      temporalScore: number;
      severityScore: number;
      mlAnomalyScore: number;
    };
    evidence: string;
    evidenceCount?: number;
    affectedServices?: string[];
  }>;
  reconstructedTimeline: string[];
  propagationChain: string[];
  summaryNarrative: string;
  recommendedActions: string[];
  /** Engine-derived suggested causes (no AI required) */
  suggestedCauses?: string[];
  /** Engine-derived suggested fixes (no AI required) */
  suggestedFixes?: string[];
  /** Human-readable explanation combining verdict, causes, fixes */
  humanExplanation?: string;
}

export interface ParsedIncidentEvent {
  rawLine: string;
  timestamp: string;
  host?: string;
  service: string;
  source?: "file" | "stdin";
  sourceName?: string;
  pid?: string;
  severity: Severity;
  message: string;
  normalizedType: string;
  tags: string[];
  correlationId?: string;
  inferredDependencies: string[];
  parseConfidence: number;
}

export interface AnalysisWindow {
  start: string;
  end: string;
  durationSeconds: number;
}

export interface AiReport {
  type: ReportType;
  title: string;
  body: string;
  generatedAt: string;
}

export interface AiAnalysis {
  available: boolean;
  summary?: string;
  timelineNarrative?: string;
  rootCauseCandidates: string[];
  followUpQuestions: string[];
  recommendedChecks: string[];
  reports: Partial<Record<ReportType, AiReport>>;
  warning?: string;
}

export interface TransportDiagnostics {
  backendReachable: boolean;
  latencyMs?: number;
  statusCode?: number;
}

export interface IncidentSchema {
  schemaVersion: string;
  generatedAt: string;
  timeline: TimelineEntry[];
  flow: FlowEdge[];
  traceGraph: TraceGraph;
  assessment: IncidentAssessment;
  signals: Signal[];
  summary: IncidentSummary;
}

export interface AnalysisResult {
  mode: AppMode;
  inputSources: InputSource[];
  summary: IncidentSummary;
  assessment: IncidentAssessment;
  analysisWindow?: AnalysisWindow;
  parsedEvents?: ParsedIncidentEvent[];
  timeline: TimelineEntry[];
  flow: FlowEdge[];
  traceGraph: TraceGraph;
  rawEvents: TimelineEntry[];
  signals: Signal[];
  ai: AiAnalysis;
  schema: IncidentSchema;
  diagnostics: {
    warnings: string[];
    errors: string[];
    transport: TransportDiagnostics;
    scoreBreakdowns?: Array<{ candidateId: string; weightedScore: number; breakdown: NonNullable<IncidentAssessment["rootCauseCandidates"][number]["scoreBreakdown"]> }>;
    parseCoverage?: number;
    timestampCoverage?: number;
    serviceCoverage?: number;
    severityCoverage?: number;
    evidenceDensity?: number;
    ambiguityFlags?: string[];
    mlContribution?: number;
    mlModel?: string;
    mlNotes?: string;
  };
  metadata: {
    rawLineCount: number;
    createdAt: string;
  };
  /** ML enrichment (anomaly scores, clusters) when engine runs ML */
  mlEnrichment?: MlEnrichment;
}

export type TuiPanelId =
  | "summary"
  | "timeline"
  | "trace-graph"
  | "mindmap"
  | "signals"
  | "evidence"
  | "ai-analysis"
  | "reports"
  | "diagnostics";

export interface TuiState {
  activePanel: TuiPanelId;
  showHelp: boolean;
  searchQuery: string;
  filter: string;
  mainScroll: number;
  sideScroll: number;
  focusRegion?: "main" | "side";
  message?: string;
  warnings: string[];
}

