import type { RawLogLine } from "../../contracts/index.js";
import { parseLines } from "../parser.js";
import type { AdapterCandidate, AdapterIngestResult, AdapterInput, AdapterMatchResult, CanonicalEvent, InputAdapter } from "./types.js";

function toUtf8(content: string | Buffer): string {
  return typeof content === "string" ? content : content.toString("utf8");
}

function isLikelyBinary(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  let nonPrintable = 0;
  const sample = buf.subarray(0, Math.min(512, buf.length));
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13) continue;
    if (byte < 32 || byte > 126) nonPrintable += 1;
  }
  return nonPrintable / sample.length > 0.35;
}

function toRawLines(text: string, sourceName?: string): RawLogLine[] {
  const rows = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return rows.map((line, idx) => ({
    line,
    lineNumber: idx + 1,
    source: "file",
    sourceName: sourceName ?? "text-log",
  }));
}

function toCanonicalLogEvents(lines: RawLogLine[]): CanonicalEvent[] {
  const parsed = parseLines(lines);
  return parsed.map((event) => ({
    type: "log",
    source: "text-log",
    timestamp: event.timestamp,
    level: event.level ?? event.severity,
    message: event.message,
    service: event.service,
    host: event.host,
    pid: event.pid,
    namespace: event.namespace,
    pod: event.pod,
    container: event.container,
    traceId: event.traceId,
    spanId: event.spanId,
    attributes: event.attributes,
    raw: event.raw,
    sourceFields: event.sourceFields,
    parserId: event.parserId,
    parseConfidence: event.parseConfidence,
    parseReasons: event.parseReasons,
    parseWarnings: event.parseWarnings,
    diagnostics: {
      parser: {
        parserId: event.parserId,
        parseConfidence: event.parseConfidence,
        parseReasons: event.parseReasons,
        parseWarnings: event.parseWarnings,
      },
    },
  }));
}

export const textLogAdapter: InputAdapter = {
  adapterId: "text-log",
  displayName: "Text Log Adapter",
  category: "text-log",
  supportedExtensions: [".log", ".txt", ".out", ".err", ".ndjson"],
  supportedMimeTypes: ["text/plain", "application/x-ndjson"],
  canHandle: (input: AdapterInput): AdapterMatchResult => {
    const path = input.context?.path?.toLowerCase() ?? "";
    const mime = input.context?.mimeType?.toLowerCase() ?? "";
    const reasons: string[] = [];
    let confidence = 0.55;
    if (path.endsWith(".log") || path.endsWith(".txt") || path.endsWith(".out") || path.endsWith(".err")) {
      confidence = 0.85;
      reasons.push("text log extension detected");
    }
    if (mime.startsWith("text/") || mime.includes("ndjson")) {
      confidence = Math.max(confidence, 0.82);
      reasons.push("text-like mime type detected");
    }
    if (Buffer.isBuffer(input.content) && isLikelyBinary(input.content)) {
      return {
        matched: false,
        confidence: 0,
        reasons: ["content appears binary; not suitable for text adapter"],
        hardReject: true,
      };
    }
    const text = toUtf8(input.content);
    if (!text.trim()) {
      return { matched: false, confidence: 0, reasons: ["empty content"], hardReject: true };
    }
    if (reasons.length === 0) reasons.push("default text adapter fallback");
    return { matched: true, confidence, reasons };
  },
  ingest: (input: AdapterInput, selection: AdapterMatchResult, candidates: AdapterCandidate[]): AdapterIngestResult => {
    const sourceName = input.context?.sourceName ?? input.context?.path ?? "text-log";
    const text = toUtf8(input.content);
    const lines = toRawLines(text, sourceName);
    const events = toCanonicalLogEvents(lines);
    for (const event of events) {
      event.adapterId = "text-log";
      event.adapterConfidence = selection.confidence;
      event.adapterReasons = selection.reasons;
      event.adapterWarnings = selection.warnings;
      event.diagnostics = {
        ...(event.diagnostics ?? {}),
        adapter: {
          adapterId: "text-log",
          adapterConfidence: selection.confidence,
          adapterReasons: selection.reasons,
          adapterWarnings: selection.warnings,
        },
      };
    }
    return {
      adapterId: "text-log",
      adapterConfidence: selection.confidence,
      adapterReasons: selection.reasons,
      adapterWarnings: selection.warnings,
      candidateAdapters: candidates,
      kind: "text-lines",
      lines,
      events,
      warnings: lines.length === 0 ? ["text adapter produced no non-empty lines"] : undefined,
    };
  },
};

