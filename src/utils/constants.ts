/**
 * CLI constants and default values.
 */

export const CLI_NAME = "solidx";
export const CLI_DESCRIPTION = "Turn messy logs into incident timelines.";
export const VERSION = "0.1.0";

export const STREAM_DEFAULTS = {
  windowSeconds: 30,
  patternThreshold: 3,
} as const;

export const REPORT_DEFAULT_OUTPUT = "incident-report.md";
export const REPORT_DEFAULT_TITLE = "Incident Report";

/** Keywords used by mock analysis heuristics */
export const SEVERITY_KEYWORDS: Record<string, string[]> = {
  critical: ["crashloop", "back-off", "backoff", "fatal", "panic", "oom", "oomkilled"],
  error: ["error", "failed", "refused", "timeout", "exception", "unable", "denied"],
  warning: ["warn", "retry", "degraded", "throttl", "slow"],
  info: ["info", "start", "started", "ready", "listening", "connected"],
  debug: ["debug", "trace"],
};

/** Event-type patterns for trace graph annotations (inferred from message) */
export const EVENT_TYPE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /connection refused|refused|connect: connection refused/i, label: "connection refused" },
  { pattern: /timeout|deadline exceeded|timed out/i, label: "timeout" },
  { pattern: /retry|attempt \d+|retrying/i, label: "retry storm" },
  { pattern: /5\d{2}|5xx|internal server error|500|502|503/i, label: "5xx spike" },
  { pattern: /4\d{2}|4xx|rate limit|throttl/i, label: "rate limit" },
  { pattern: /pool exhausted|connection pool/i, label: "pool exhausted" },
  { pattern: /crashloop|back-off|backoff|restarting failed/i, label: "crash" },
  { pattern: /latency|slow|degraded/i, label: "latency spike" },
  { pattern: /error|failed|exception/i, label: "error" },
];

export const SERVICE_PATTERNS = [
  /"service"\s*:\s*"([^"]+)"/,
  /"name"\s*:\s*"([^"]+)"/,
  /"pod"\s*:\s*"([^"]+)"/,
  /([a-zA-Z0-9_.-]+)\[\d+\]:/,
  /([a-zA-Z0-9_.-]+)\s+pod\s+(?:deleted|created|updated)/i,
  /(?:statefulset|deployment)\s+([a-zA-Z0-9_.-]+)/i,
  /(?:service|svc|app)[\s=:]+["']?([a-zA-Z0-9_.-]+)["']?/i,
  /(?:pod|deployment)[\s=:]+["']?([a-zA-Z0-9_.-]+)["']?/i,
  /(?:component|comp)[\s=:]+["']?([a-zA-Z0-9_.-]+)["']?/i,
  /\[([a-zA-Z0-9_.-]+)\]/,
];
