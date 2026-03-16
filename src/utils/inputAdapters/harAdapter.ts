import { parseTimestamp } from "../timestamp.js";
import type { AdapterCandidate, AdapterIngestResult, AdapterInput, AdapterMatchResult, CanonicalEvent, InputAdapter } from "./types.js";

interface HarLike {
  log?: {
    entries?: Array<Record<string, unknown>>;
  };
}

function toUtf8(content: string | Buffer): string {
  return typeof content === "string" ? content : content.toString("utf8");
}

function safeParseJson(text: string): { value: HarLike | null; warning?: string } {
  try {
    return { value: JSON.parse(text) as HarLike };
  } catch {
    return { value: null, warning: "HAR JSON parse failed" };
  }
}

function toHttpEvent(entry: Record<string, unknown>): CanonicalEvent {
  const request = (entry.request as Record<string, unknown> | undefined) ?? {};
  const response = (entry.response as Record<string, unknown> | undefined) ?? {};
  const startedDateTime = typeof entry.startedDateTime === "string" ? entry.startedDateTime : undefined;
  const ts = parseTimestamp(startedDateTime);
  const url = typeof request.url === "string" ? request.url : undefined;
  let host: string | undefined;
  try {
    host = url ? new URL(url).hostname : undefined;
  } catch {
    host = undefined;
  }
  return {
    type: "http",
    source: "har",
    timestamp: ts?.timestamp,
    level: "info",
    message: typeof response.statusText === "string" ? response.statusText : "HTTP transaction",
    host,
    protocol: typeof request.httpVersion === "string" ? request.httpVersion : "http",
    method: typeof request.method === "string" ? request.method : undefined,
    url,
    statusCode: typeof response.status === "number" ? response.status : undefined,
    latencyMs: typeof entry.time === "number" ? entry.time : undefined,
    sourceFields: entry,
    parseWarnings: ts ? undefined : ["har entry timestamp missing or unparseable"],
    diagnostics: {
      parser: {
        parserId: "har-entry-mapper",
        parseConfidence: ts ? 0.9 : 0.72,
        parseReasons: ["mapped HAR log entry to canonical http event"],
        parseWarnings: ts ? undefined : ["har entry timestamp missing or unparseable"],
      },
    },
  };
}

export const harAdapter: InputAdapter = {
  adapterId: "har",
  displayName: "HAR Adapter",
  category: "structured",
  supportedExtensions: [".har"],
  supportedMimeTypes: ["application/json", "application/har+json"],
  canHandle: (input: AdapterInput): AdapterMatchResult => {
    const path = input.context?.path?.toLowerCase() ?? "";
    const text = toUtf8(input.content).trim();
    if (path.endsWith(".har")) {
      return { matched: true, confidence: 0.95, reasons: ["har extension detected"] };
    }
    if (!text.startsWith("{")) {
      return { matched: false, confidence: 0, reasons: ["har must be JSON object"] };
    }
    if (/"log"\s*:\s*\{/.test(text) && /"entries"\s*:\s*\[/.test(text)) {
      return { matched: true, confidence: 0.9, reasons: ["har log.entries structure detected"] };
    }
    return { matched: false, confidence: 0, reasons: ["har signatures not found"] };
  },
  ingest: (input: AdapterInput, selection: AdapterMatchResult, candidates: AdapterCandidate[]): AdapterIngestResult => {
    const text = toUtf8(input.content);
    const { value, warning } = safeParseJson(text);
    const warnings: string[] = [];
    if (warning) warnings.push(warning);
    const entries = value?.log?.entries;
    if (!Array.isArray(entries)) {
      warnings.push("HAR entries missing; returning empty HTTP event set");
      return {
        adapterId: "har",
        adapterConfidence: selection.confidence,
        adapterReasons: selection.reasons,
        adapterWarnings: selection.warnings,
        candidateAdapters: candidates,
        kind: "canonical-events",
        events: [],
        warnings,
      };
    }
    const events = entries.map((entry) => toHttpEvent(entry));
    for (const event of events) {
      event.adapterId = "har";
      event.adapterConfidence = selection.confidence;
      event.adapterReasons = selection.reasons;
      event.adapterWarnings = selection.warnings;
      event.diagnostics = {
        ...(event.diagnostics ?? {}),
        adapter: {
          adapterId: "har",
          adapterConfidence: selection.confidence,
          adapterReasons: selection.reasons,
          adapterWarnings: selection.warnings,
        },
      };
    }
    return {
      adapterId: "har",
      adapterConfidence: selection.confidence,
      adapterReasons: selection.reasons,
      adapterWarnings: selection.warnings,
      candidateAdapters: candidates,
      kind: "canonical-events",
      events,
      warnings: warnings.length ? warnings : undefined,
    };
  },
};

