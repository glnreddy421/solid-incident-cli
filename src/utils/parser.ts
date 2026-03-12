/**
 * Log line parser: plain text, JSON-ish lines, Kubernetes-style prefixes.
 * Handles missing timestamps and service names gracefully.
 */

import type { RawLogLine, ParsedEvent, Severity } from "./types.js";
import { SEVERITY_KEYWORDS, SERVICE_PATTERNS } from "./constants.js";

const ISO_REGEX =
  /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/;
const K8S_PREFIX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(stdout|stderr)\s+[A-Z]\s+/;

export function parseLines(rawLines: RawLogLine[]): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  for (const { line, lineNumber } of rawLines) {
    const event = parseLine(line, lineNumber);
    if (event) events.push(event);
  }
  return sortEventsByTime(events);
}

function parseLine(line: string, lineNumber: number): ParsedEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let timestamp = "unknown";
  let rest = trimmed;

  const k8sMatch = trimmed.match(K8S_PREFIX);
  if (k8sMatch) {
    timestamp = k8sMatch[1];
    rest = trimmed.slice(k8sMatch[0].length);
  } else {
    const isoMatch = trimmed.match(ISO_REGEX);
    if (isoMatch) {
      timestamp = normalizeTimestamp(isoMatch[1]);
      rest = trimmed.slice(isoMatch.index! + isoMatch[1].length).trim();
    }
  }

  const service = inferService(rest) ?? "unknown-service";
  const severity = inferSeverity(rest);
  const message = extractMessage(rest);

  return {
    timestamp,
    service,
    severity,
    message: message || rest.slice(0, 120),
    raw: trimmed.length > 200 ? trimmed.slice(0, 200) + "…" : trimmed,
    lineNumber,
  };
}

function normalizeTimestamp(ts: string): string {
  const t = ts.replace(" ", "T");
  if (/Z|[+-]\d{2}:?\d{2}$/.test(t)) return t;
  return t + "Z";
}

function inferSeverity(text: string): Severity {
  const lower = text.toLowerCase();
  for (const [sev, keywords] of Object.entries(SEVERITY_KEYWORDS)) {
    if (keywords.some((k) => lower.includes(k))) return sev as Severity;
  }
  return "info";
}

function inferService(text: string): string | null {
  const json = tryParseJson(text);
  if (json && typeof json.service === "string" && json.service.length > 1) return json.service;
  if (json && typeof json.name === "string" && json.name.length > 1) return json.name;
  for (const re of SERVICE_PATTERNS) {
    const m = text.match(re);
    if (m?.[1] && m[1].length > 2) return m[1]; // avoid single-word false positives like "in", "v2"
  }
  return null;
}

function tryParseJson(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function extractMessage(text: string): string {
  const json = tryParseJson(text);
  if (json && typeof json.msg === "string") return json.msg;
  if (json && typeof json.message === "string") return json.message;
  if (json && typeof json.error === "string") return json.error;
  const msgMatch = text.match(/"msg"\s*:\s*"([^"]+)"/);
  if (msgMatch) return msgMatch[1];
  const errMatch = text.match(/"error"\s*:\s*"([^"]+)"/);
  if (errMatch) return errMatch[1];
  return text.slice(0, 200).trim();
}

function sortEventsByTime(events: ParsedEvent[]): ParsedEvent[] {
  return [...events].sort((a, b) => {
    if (a.timestamp === "unknown" && b.timestamp === "unknown") return 0;
    if (a.timestamp === "unknown") return 1;
    if (b.timestamp === "unknown") return -1;
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });
}

export function formatTimestampForDisplay(ts: string): string {
  if (ts === "unknown") return "unknown";
  try {
    const d = new Date(ts);
    return d.toISOString().replace("T", " ").slice(11, 19);
  } catch {
    return ts;
  }
}
