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

export const SERVICE_PATTERNS = [
  /(?:service|svc|app)[\s=:]+["']?([a-zA-Z0-9_-]+)["']?/i,
  /(?:pod|deployment)[\s=:]+["']?([a-zA-Z0-9_-]+)["']?/i,
  /(?:component|comp)[\s=:]+["']?([a-zA-Z0-9_-]+)["']?/i,
  /"service"\s*:\s*"([^"]+)"/,
  /"name"\s*:\s*"([^"]+)"/,
  /\[([a-zA-Z0-9_-]+)\]/,
];
