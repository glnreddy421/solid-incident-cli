/**
 * User-facing explanations of engine-derived headline metrics.
 * Keep aligned with `computeHealthScore` (incidentAssessment) and `deriveConfidence` (analysisEngine).
 */

/** 0–100 from distribution + structure; not a product SLA score. */
export const METRIC_HINT_HEALTH =
  "Starts at 100, then subtracts capped penalties for errors, warnings, anomalies, propagation edges, and how many signals fired.";

/** summary.confidence: 15–98 integer percent. */
export const METRIC_HINT_SUMMARY_CONFIDENCE =
  "Blends leading root-cause scores with parse/timestamp/service/evidence trust, minus ambiguity or weak coverage.";

export const METRIC_HINT_VERDICT =
  "Rule-based from severities, failure-type signals, and cross-service propagation—deterministic engine, not the LLM.";

export const METRIC_HINT_EVENTS = "Structured timeline rows parsed from your input in this window.";

export const METRIC_HINT_SERVICES = "Distinct services named in parsed events in this window.";

/** Narrow TUI columns: one line each where possible. */
export const METRIC_HINT_HEALTH_TUI =
  "100 − capped penalties: errors/warns/anomalies, edges, #signals.";
export const METRIC_HINT_SUMMARY_CONFIDENCE_TUI =
  "Top hypotheses + parse/time/service/evidence trust − gaps.";
export const METRIC_HINT_VERDICT_TUI = "Severities + signals + trace rules (no LLM).";
export const METRIC_HINT_EVENTS_TUI = "Parsed log lines in the timeline.";

export const METRIC_HINT_SERVICES_TUI = "Distinct services in parsed events.";
