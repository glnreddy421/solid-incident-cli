/**
 * Shared types for SOLID CLI.
 * Align with backend API contracts when integrating.
 */

export type Severity = "critical" | "error" | "warning" | "info" | "debug";

/** A single raw line read from a file or stream */
export interface RawLogLine {
  line: string;
  lineNumber: number;
  source?: "file" | "stdin";
}

/** A parsed, normalized event derived from log lines */
export interface ParsedEvent {
  timestamp: string; // ISO or "unknown"
  service: string;
  component?: string;
  severity: Severity;
  message: string;
  raw?: string;
  lineNumber?: number;
}

/** A detected pattern or anomaly */
export interface Signal {
  label: string;
  description?: string;
  severity: Severity;
  count?: number;
  service?: string;
}

/** High-level incident summary from analysis */
export interface IncidentSummary {
  whatHappened: string;
  likelyRootCause: string;
  confidence: number; // 0–100
  impactedServices: string[];
  suggestedNextSteps: string[];
}

/** Full result of analyzing logs */
export interface AnalysisResult {
  events: ParsedEvent[];
  signals: Signal[];
  summary: IncidentSummary;
  rawLineCount: number;
}

/** Options for analysis (future: backend URL, auth, etc.) */
export interface AnalyzeOptions {
  includeRawEvents?: boolean;
  /** TODO: backend integration — e.g. apiUrl, apiKey */
}
