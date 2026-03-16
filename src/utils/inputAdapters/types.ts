import type { RawLogLine } from "../../contracts/index.js";

export type AdapterCategory = "text-log" | "structured" | "binary-capture" | "network" | "generic";
export type CanonicalEventType = "log" | "http" | "network" | "dns" | "tls" | "generic";

/**
 * CanonicalEvent is the stable cross-adapter event contract consumed by
 * correlation, engine analysis, and UI layers.
 */
export interface CanonicalEvent {
  id?: string;
  type: CanonicalEventType;
  source: string;
  sourceId?: string;
  sourceType?: string;
  sourceName?: string;
  sourcePath?: string;
  timestamp?: string;
  receivedAt?: string;
  level?: string;
  message?: string;
  service?: string;
  host?: string;
  pid?: string;
  namespace?: string;
  pod?: string;
  container?: string;
  traceId?: string;
  spanId?: string;
  requestId?: string;
  protocol?: string;
  srcIp?: string;
  dstIp?: string;
  srcPort?: number;
  dstPort?: number;
  method?: string;
  url?: string;
  statusCode?: number;
  latencyMs?: number;
  attributes?: Record<string, unknown>;
  raw?: string;
  sourceFields?: Record<string, unknown>;
  parserId?: string;
  parseConfidence?: number;
  parseReasons?: string[];
  parseWarnings?: string[];
  adapterId?: string;
  adapterConfidence?: number;
  adapterReasons?: string[];
  adapterWarnings?: string[];
  /**
   * Structured diagnostics block for strict contract consumers.
   * Top-level parser/adapter fields remain for backward compatibility.
   */
  diagnostics?: {
    parser?: {
      parserId?: string;
      parseConfidence?: number;
      parseReasons?: string[];
      parseWarnings?: string[];
    };
    adapter?: {
      adapterId?: string;
      adapterConfidence?: number;
      adapterReasons?: string[];
      adapterWarnings?: string[];
    };
  };
}

export interface AdapterContext {
  path?: string;
  mimeType?: string;
  sourceName?: string;
  sourceKind?: "file" | "stdin" | "memory";
}

export interface AdapterInput {
  content: string | Buffer;
  context?: AdapterContext;
}

export interface AdapterMatchResult {
  matched: boolean;
  confidence: number;
  reasons: string[];
  warnings?: string[];
  hardReject?: boolean;
}

export interface AdapterCandidate {
  adapterId: string;
  confidence: number;
  reasons: string[];
}

export interface AdapterIngestResult {
  adapterId: string;
  adapterConfidence: number;
  adapterReasons: string[];
  adapterWarnings?: string[];
  candidateAdapters: AdapterCandidate[];
  kind: "text-lines" | "canonical-events" | "unsupported";
  lines?: RawLogLine[];
  events: CanonicalEvent[];
  warnings?: string[];
}

export interface InputAdapter {
  adapterId: string;
  displayName: string;
  category: AdapterCategory;
  supportedMimeTypes?: string[];
  supportedExtensions?: string[];
  canHandle: (input: AdapterInput) => AdapterMatchResult;
  ingest: (input: AdapterInput, selection: AdapterMatchResult, candidates: AdapterCandidate[]) => AdapterIngestResult;
}

