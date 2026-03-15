export type AppMode = "tui" | "text" | "json" | "markdown" | "html";

export type ReportType = "incident" | "rca" | "interview-story";

export type Severity = "critical" | "error" | "warning" | "info" | "debug";

export interface InputSource {
  kind: "file" | "stdin";
  name: string;
}

export interface RawLogLine {
  line: string;
  lineNumber: number;
  source?: "file" | "stdin";
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

export interface Signal {
  label: string;
  description?: string;
  severity: Severity;
  count?: number;
  service?: string;
  score?: number;
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
  signals: Signal[];
  summary: IncidentSummary;
}

export interface AnalysisResult {
  mode: AppMode;
  inputSources: InputSource[];
  summary: IncidentSummary;
  timeline: TimelineEntry[];
  flow: FlowEdge[];
  rawEvents: TimelineEntry[];
  signals: Signal[];
  ai: AiAnalysis;
  schema: IncidentSchema;
  diagnostics: {
    warnings: string[];
    errors: string[];
    transport: TransportDiagnostics;
  };
  metadata: {
    rawLineCount: number;
    createdAt: string;
  };
}

export type TuiPanelId =
  | "summary"
  | "timeline"
  | "flow"
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
  focusRegion?: "main" | "side";
  message?: string;
  warnings: string[];
}

