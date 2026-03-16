import type { ParsedEvent, RawLogLine, Severity } from "./types.js";
import { SEVERITY_KEYWORDS, SERVICE_PATTERNS } from "./constants.js";
import { parseTimestamp } from "./timestamp.js";

export interface ParseResult {
  event: ParsedEvent;
  confidence: number;
}

export interface ParserMatchResult {
  matched: boolean;
  confidence: number;
  reasons: string[];
  warnings?: string[];
  hardReject?: boolean;
}

interface ParserContext {
  line: string;
  lineNumber: number;
}

interface ParserParseResult {
  values: Partial<ParsedEvent>;
  confidence?: number;
  reasons?: string[];
  warnings?: string[];
}

export interface LineParserPlugin {
  id: string;
  canParse: (line: string, context?: ParserContext) => ParserMatchResult;
  parse: (line: string, context: ParserContext) => ParserParseResult | null;
}

export interface ParserMetrics {
  parserHits: Record<string, number>;
  fallbackHits: number;
  warningCount: number;
  parseFailureCount: number;
  ambiguousMatches: number;
}

const metrics: ParserMetrics = {
  parserHits: {},
  fallbackHits: 0,
  warningCount: 0,
  parseFailureCount: 0,
  ambiguousMatches: 0,
};

const ISO_REGEX =
  /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/;
const K8S_PREFIX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(stdout|stderr)\s+[A-Z]\s+/;
const SYSLOG_PREFIX = /^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+([^\s]+)\s+([a-zA-Z0-9_.-]+)(?:\[(\d+)\])?:\s*(.*)$/;

const KNOWN_LEVELS = new Set(["critical", "error", "warning", "warn", "info", "debug"]);

function tryParseJson(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function extractJsonStartFromLine(line: string): string | null {
  const idx = line.indexOf("{");
  if (idx < 0) return null;
  return line.slice(idx).trim();
}

function inferSeverity(text: string, json?: Record<string, unknown> | null): Severity {
  const level = typeof json?.level === "string" ? String(json.level).toLowerCase() : "";
  if (level === "warn") return "warning";
  if (KNOWN_LEVELS.has(level)) return level === "warn" ? "warning" : (level as Severity);
  const lower = text.toLowerCase();
  for (const [sev, keywords] of Object.entries(SEVERITY_KEYWORDS)) {
    if (keywords.some((k) => lower.includes(k))) return sev as Severity;
  }
  return "info";
}

function inferService(text: string, json?: Record<string, unknown> | null): string | null {
  if (json && typeof json.service === "string" && json.service.length > 1) return json.service;
  if (json && typeof json.name === "string" && json.name.length > 1) return json.name;
  if (json && typeof json.component === "string" && json.component.length > 1) return json.component;
  const prefixedSevMatch = text.match(/^([a-zA-Z][a-zA-Z0-9_.-]{1,})\s+(critical|error|warn(?:ing)?|info|debug)\b/i);
  if (prefixedSevMatch?.[1]) return prefixedSevMatch[1];
  for (const re of SERVICE_PATTERNS) {
    const m = text.match(re);
    if (!m?.[1] || m[1].length <= 2) continue;
    const candidate = m[1].trim();
    if (/^\d+$/.test(candidate)) continue;
    return candidate;
  }
  return null;
}

function inferMessage(text: string, json?: Record<string, unknown> | null): string {
  if (json && typeof json.msg === "string") return json.msg;
  if (json && typeof json.message === "string") return json.message;
  if (json && typeof json.error === "string") return json.error;
  const msgMatch = text.match(/"msg"\s*:\s*"([^"]+)"/);
  if (msgMatch) return msgMatch[1];
  const errMatch = text.match(/"error"\s*:\s*"([^"]+)"/);
  if (errMatch) return errMatch[1];
  return text.slice(0, 220).trim();
}

function inferTraceIds(text: string): { traceId?: string; spanId?: string } {
  const traceId = text.match(/(?:trace[_-]?id|traceid)[\s=:]+["']?([a-zA-Z0-9-_.]+)/i)?.[1];
  const spanId = text.match(/(?:span[_-]?id|spanid)[\s=:]+["']?([a-zA-Z0-9-_.]+)/i)?.[1];
  return { traceId, spanId };
}

function normalizeEvent(
  parserId: string,
  rawLine: string,
  lineNumber: number,
  parseResult: ParserParseResult,
  matchResult: ParserMatchResult,
  candidateParsers: ParsedEvent["candidateParsers"]
): ParseResult {
  const warnings = [...(matchResult.warnings ?? []), ...(parseResult.warnings ?? [])];
  const reasons = [...(matchResult.reasons ?? []), ...(parseResult.reasons ?? [])];
  const confidence = Math.max(0.05, Math.min(0.99, parseResult.confidence ?? matchResult.confidence));

  const severity = parseResult.values.severity ?? parseResult.values.level ?? "info";
  const service = parseResult.values.service ?? "unknown-service";
  const message = parseResult.values.message ?? rawLine.slice(0, 220).trim();
  const timestamp = parseResult.values.timestamp ?? "unknown";

  const event: ParsedEvent = {
    timestamp,
    timestampSource: parseResult.values.timestampSource,
    timezoneAssumed: parseResult.values.timezoneAssumed,
    timestampInferred: parseResult.values.timestampInferred,
    service,
    severity,
    level: severity,
    message,
    host: parseResult.values.host,
    pid: parseResult.values.pid,
    namespace: parseResult.values.namespace,
    pod: parseResult.values.pod,
    container: parseResult.values.container,
    traceId: parseResult.values.traceId,
    spanId: parseResult.values.spanId,
    attributes: parseResult.values.attributes,
    sourceFields: parseResult.values.sourceFields,
    parserMeta: {
      parserId,
      ...((parseResult.values.parserMeta ?? {}) as Record<string, unknown>),
    },
    raw: rawLine.length > 220 ? rawLine.slice(0, 220) + "…" : rawLine,
    lineNumber,
    parserId,
    parseConfidence: confidence,
    parseReasons: reasons,
    parseWarnings: warnings.length ? warnings : undefined,
    candidateParsers,
  };

  if (warnings.length) metrics.warningCount += warnings.length;
  return { event, confidence };
}

const jsonParser: LineParserPlugin = {
  id: "json",
  canParse: (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      return { matched: false, confidence: 0, reasons: ["line is not object-shaped JSON"] };
    }
    const json = tryParseJson(trimmed);
    if (!json) {
      return { matched: false, confidence: 0, reasons: ["json parse failed"], hardReject: true };
    }
    const keys = Object.keys(json);
    const evidenceKeys = keys.filter((k) => ["message", "msg", "error", "level", "severity", "service", "timestamp", "time", "ts"].includes(k));
    if (evidenceKeys.length === 0 && keys.length < 2) {
      return { matched: false, confidence: 0, reasons: ["json object missing logging evidence"], hardReject: true };
    }
    return { matched: true, confidence: 0.95, reasons: ["valid structured JSON object", `evidence keys: ${evidenceKeys.join(",") || "none"}`] };
  },
  parse: (line) => {
    const json = tryParseJson(line.trim());
    if (!json) return null;
    const tsRaw = typeof json.timestamp === "string"
      ? json.timestamp
      : typeof json.time === "string"
        ? json.time
        : typeof json.ts === "string"
          ? json.ts
          : undefined;
    const parsedTs = parseTimestamp(tsRaw);
    const service = inferService(line, json) ?? "unknown-service";
    const severity = inferSeverity(line, json);
    const message = inferMessage(line, json);
    const { traceId, spanId } = inferTraceIds(line);
    const warnings: string[] = [];
    if (!parsedTs) warnings.push("json timestamp missing or unparseable");
    if (service === "unknown-service") warnings.push("service could not be extracted from JSON payload");
    return {
      values: {
        timestamp: parsedTs?.timestamp ?? "unknown",
        timestampSource: parsedTs?.timestampSource,
        timezoneAssumed: parsedTs?.timezoneAssumed,
        timestampInferred: parsedTs?.timestampInferred,
        service,
        severity,
        level: severity,
        message,
        traceId,
        spanId,
        attributes: json,
        sourceFields: json,
      },
      confidence: parsedTs ? 0.96 : 0.9,
      reasons: ["parsed JSON fields into canonical event"],
      warnings,
    };
  },
};

const k8sParser: LineParserPlugin = {
  id: "k8s-container",
  canParse: (line) => {
    const match = line.match(K8S_PREFIX);
    if (!match) return { matched: false, confidence: 0, reasons: ["no k8s prefix detected"] };
    return { matched: true, confidence: 0.94, reasons: ["k8s container prefix matched"], warnings: [] };
  },
  parse: (line) => {
    const match = line.match(K8S_PREFIX);
    if (!match) return null;
    const parsedTs = parseTimestamp(match[1]);
    const rest = line.slice(match[0].length).trim();
    const maybeJsonText = extractJsonStartFromLine(rest);
    const json = maybeJsonText ? tryParseJson(maybeJsonText) : tryParseJson(rest);
    const service = inferService(rest, json) ?? "unknown-service";
    const severity = inferSeverity(rest, json);
    const message = inferMessage(rest, json);
    const { traceId, spanId } = inferTraceIds(rest);
    const warnings: string[] = [];
    if (!json && maybeJsonText) warnings.push("k8s payload looked JSON-like but parse failed");
    if (service === "unknown-service") warnings.push("service missing in k8s payload");
    return {
      values: {
        timestamp: parsedTs?.timestamp ?? "unknown",
        timestampSource: parsedTs?.timestampSource ?? "k8s-prefix",
        timezoneAssumed: parsedTs?.timezoneAssumed,
        timestampInferred: parsedTs?.timestampInferred,
        service,
        severity,
        level: severity,
        message,
        traceId,
        spanId,
        sourceFields: json ?? { payload: rest },
      },
      confidence: 0.93,
      reasons: ["parsed outer k8s envelope", "parsed inner payload heuristics"],
      warnings,
    };
  },
};

const syslogParser: LineParserPlugin = {
  id: "syslog-rfc3164",
  canParse: (line) => {
    const match = line.match(SYSLOG_PREFIX);
    if (!match) return { matched: false, confidence: 0, reasons: ["no RFC3164 structure detected"] };
    if (!match[3] || !match[5]) {
      return { matched: false, confidence: 0, reasons: ["syslog structure incomplete"], hardReject: true };
    }
    return { matched: true, confidence: 0.9, reasons: ["rfc3164 timestamp+host+service structure matched"] };
  },
  parse: (line) => {
    const match = line.match(SYSLOG_PREFIX);
    if (!match) return null;
    const parsedTs = parseTimestamp(match[1]);
    const host = match[2];
    const service = match[3] ?? "unknown-service";
    const pid = match[4];
    const rest = match[5] ?? "";
    const severity = inferSeverity(rest);
    const { traceId, spanId } = inferTraceIds(rest);
    return {
      values: {
        timestamp: parsedTs?.timestamp ?? "unknown",
        timestampSource: parsedTs?.timestampSource,
        timezoneAssumed: parsedTs?.timezoneAssumed,
        timestampInferred: parsedTs?.timestampInferred,
        service,
        host,
        pid,
        severity,
        level: severity,
        message: rest || line,
        traceId,
        spanId,
        sourceFields: { host, service, pid, message: rest },
      },
      confidence: 0.9,
      reasons: ["parsed syslog envelope fields"],
    };
  },
};

const isoTextParser: LineParserPlugin = {
  id: "iso-text",
  canParse: (line) => {
    const trimmed = line.trim();
    if (/^\[[^\]]+\]\s+\[[^\]]+\]/.test(trimmed)) {
      return { matched: false, confidence: 0, reasons: ["bracketed envelope should be handled by bracketed parser"], hardReject: true };
    }
    const startIso = trimmed.match(/^(\[)?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/);
    if (!startIso) return { matched: false, confidence: 0, reasons: ["line does not start with ISO-like timestamp"] };
    return { matched: true, confidence: 0.86, reasons: ["line starts with ISO-like timestamp"] };
  },
  parse: (line) => {
    const match = line.match(ISO_REGEX);
    if (!match) return null;
    const parsedTs = parseTimestamp(match[1]);
    const rest = line.slice((match.index ?? 0) + match[1].length).trim();
    const maybeJson = extractJsonStartFromLine(rest);
    const json = maybeJson ? tryParseJson(maybeJson) : tryParseJson(rest);
    const service = inferService(rest, json) ?? "unknown-service";
    const severity = inferSeverity(rest, json);
    const message = inferMessage(rest, json);
    const { traceId, spanId } = inferTraceIds(rest);
    const warnings: string[] = [];
    if (maybeJson && !json) warnings.push("payload looked JSON-like but JSON parse failed");
    return {
      values: {
        timestamp: parsedTs?.timestamp ?? "unknown",
        timestampSource: parsedTs?.timestampSource,
        timezoneAssumed: parsedTs?.timezoneAssumed,
        timestampInferred: parsedTs?.timestampInferred,
        service,
        severity,
        level: severity,
        message,
        traceId,
        spanId,
        sourceFields: json ?? { payload: rest },
      },
      confidence: 0.86,
      reasons: ["parsed ISO timestamp envelope"],
      warnings,
    };
  },
};

const keyValueParser: LineParserPlugin = {
  id: "key-value",
  canParse: (line) => {
    const tokens = line.match(/[a-zA-Z0-9_.-]+=(?:"[^"]*"|[^\s]+)/g) ?? [];
    const hasMsg = tokens.some((t) => /^(msg|message)=/.test(t));
    const hasSignal = tokens.some((t) => /^(time|timestamp|ts|level|severity|service|svc|app)=/.test(t));
    if (tokens.length < 3 || !hasMsg || !hasSignal) {
      return {
        matched: false,
        confidence: 0,
        reasons: ["insufficient key-value evidence"],
        hardReject: tokens.length > 0,
      };
    }
    return { matched: true, confidence: 0.84, reasons: [`${tokens.length} key-value tokens detected`] };
  },
  parse: (line) => {
    const kv = new Map<string, string>();
    for (const pair of line.match(/[a-zA-Z0-9_.-]+=(?:"[^"]*"|[^\s]+)/g) ?? []) {
      const idx = pair.indexOf("=");
      const k = pair.slice(0, idx);
      const raw = pair.slice(idx + 1);
      kv.set(k, raw.replace(/^"|"$/g, ""));
    }
    const tsRaw = kv.get("time") ?? kv.get("timestamp") ?? kv.get("ts");
    const parsedTs = parseTimestamp(tsRaw);
    const service = kv.get("service") ?? kv.get("svc") ?? kv.get("app") ?? inferService(line) ?? "unknown-service";
    const sevRaw = (kv.get("level") ?? kv.get("severity") ?? "").toLowerCase();
    const severity = sevRaw ? inferSeverity(sevRaw) : inferSeverity(line);
    const message = kv.get("msg") ?? kv.get("message") ?? inferMessage(line);
    const { traceId, spanId } = inferTraceIds(line);
    const warnings: string[] = [];
    if (!parsedTs) warnings.push("timestamp key present but value unparseable");
    return {
      values: {
        timestamp: parsedTs?.timestamp ?? "unknown",
        timestampSource: parsedTs?.timestampSource,
        timezoneAssumed: parsedTs?.timezoneAssumed,
        timestampInferred: parsedTs?.timestampInferred,
        service,
        severity,
        level: severity,
        message,
        traceId,
        spanId,
        sourceFields: Object.fromEntries(kv.entries()),
      },
      confidence: parsedTs ? 0.84 : 0.78,
      reasons: ["parsed logfmt/key-value tokens"],
      warnings,
    };
  },
};

const bracketedParser: LineParserPlugin = {
  id: "bracketed",
  canParse: (line) => {
    const parts = [...line.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
    const hasConsistentLead = /^\[[^\]]+\]\s+\[[^\]]+\]/.test(line);
    const hasLevel = parts.some((p) => /^(critical|error|warn|warning|info|debug)$/i.test(p));
    if (!hasConsistentLead || parts.length < 2 || !hasLevel) {
      return { matched: false, confidence: 0, reasons: ["bracketed structure evidence is weak"] };
    }
    return { matched: true, confidence: 0.8, reasons: ["consistent bracketed prefix with level tag"] };
  },
  parse: (line) => {
    const parts = [...line.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
    const tsCandidate = parts.find((p) => !!parseTimestamp(p));
    const levelCandidate = parts.find((p) => /^(critical|error|warn|warning|info|debug)$/i.test(p));
    const serviceCandidate = parts.find((p) => /^[a-zA-Z][a-zA-Z0-9_.-]{2,}$/.test(p) && p.toLowerCase() !== (levelCandidate ?? "").toLowerCase());
    const parsedTs = parseTimestamp(tsCandidate);
    const severity = levelCandidate ? inferSeverity(levelCandidate) : inferSeverity(line);
    const service = serviceCandidate ?? inferService(line) ?? "unknown-service";
    const message = line.replace(/^\[[^\]]+\]\s+\[[^\]]+\]\s*/g, "").slice(0, 220);
    return {
      values: {
        timestamp: parsedTs?.timestamp ?? "unknown",
        timestampSource: parsedTs?.timestampSource,
        timezoneAssumed: parsedTs?.timezoneAssumed,
        timestampInferred: parsedTs?.timestampInferred,
        service,
        severity,
        level: severity,
        message,
        sourceFields: { brackets: parts },
      },
      confidence: parsedTs ? 0.82 : 0.76,
      reasons: ["parsed bracketed envelope"],
      warnings: parsedTs ? [] : ["timestamp token was not parseable in bracketed envelope"],
    };
  },
};

const genericParser: LineParserPlugin = {
  id: "generic",
  canParse: () => ({
    matched: true,
    confidence: 0.35,
    reasons: ["fallback parser accepted line"],
    warnings: ["no structured parser matched strongly"],
  }),
  parse: (line) => {
    const service = inferService(line) ?? "unknown-service";
    const severity = inferSeverity(line);
    const message = inferMessage(line);
    const ts = parseTimestamp(line);
    return {
      values: {
        timestamp: ts?.timestamp ?? "unknown",
        timestampSource: ts?.timestampSource,
        timezoneAssumed: ts?.timezoneAssumed,
        timestampInferred: ts?.timestampInferred,
        service,
        severity,
        level: severity,
        message,
      },
      confidence: ts ? 0.5 : 0.35,
      reasons: ["heuristic fallback parse"],
      warnings: ["no structured parser matched strongly"],
    };
  },
};

const REGISTRY: LineParserPlugin[] = [
  k8sParser,
  jsonParser,
  syslogParser,
  isoTextParser,
  keyValueParser,
  bracketedParser,
  genericParser,
];

function markHit(parserId: string): void {
  metrics.parserHits[parserId] = (metrics.parserHits[parserId] ?? 0) + 1;
  if (parserId === "generic") metrics.fallbackHits += 1;
}

export function getParserMetrics(): ParserMetrics {
  return {
    parserHits: { ...metrics.parserHits },
    fallbackHits: metrics.fallbackHits,
    warningCount: metrics.warningCount,
    parseFailureCount: metrics.parseFailureCount,
    ambiguousMatches: metrics.ambiguousMatches,
  };
}

export function resetParserMetrics(): void {
  metrics.parserHits = {};
  metrics.fallbackHits = 0;
  metrics.warningCount = 0;
  metrics.parseFailureCount = 0;
  metrics.ambiguousMatches = 0;
}

export function parseLineWithRegistry(raw: RawLogLine): ParseResult | null {
  const trimmed = raw.line.trim();
  if (!trimmed) return null;

  const context: ParserContext = { line: raw.line, lineNumber: raw.lineNumber };
  const matches = REGISTRY
    .map((parser) => ({ parser, match: parser.canParse(trimmed, context) }))
    .filter((entry) => entry.match.matched && !entry.match.hardReject);

  if (matches.filter((m) => m.match.confidence >= 0.75).length > 1) {
    metrics.ambiguousMatches += 1;
  }

  const candidateParsers: ParsedEvent["candidateParsers"] = matches.map((entry) => ({
    parserId: entry.parser.id,
    confidence: entry.match.confidence,
    reasons: entry.match.reasons,
  }));

  for (const entry of matches) {
    try {
      const parsed = entry.parser.parse(raw.line, context);
      if (!parsed) continue;
      const normalized = normalizeEvent(entry.parser.id, raw.line, raw.lineNumber, parsed, entry.match, candidateParsers);
      markHit(entry.parser.id);
      return normalized;
    } catch {
      metrics.parseFailureCount += 1;
    }
  }

  metrics.parseFailureCount += 1;
  return null;
}

