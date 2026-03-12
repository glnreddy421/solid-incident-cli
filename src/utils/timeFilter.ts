/**
 * Time-window filtering for log lines.
 * Extracts timestamps and filters by --since, --from, --to, --tail.
 */

import type { RawLogLine } from "./types.js";

const ISO_REGEX = /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/;
const K8S_PREFIX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(stdout|stderr)\s+[A-Z]\s+/;

export interface TimeFilterOptions {
  since?: string; // "5m", "1h", "30m"
  from?: string;  // ISO or "14:00"
  to?: string;    // ISO or "14:15"
  tail?: number;  // last N lines
}

/** Extract timestamp from line, return ms or null if unparseable */
function extractTimestampMs(line: string): number | null {
  const trimmed = line.trim();
  let ts: string | undefined;
  const k8sMatch = trimmed.match(K8S_PREFIX);
  if (k8sMatch) ts = k8sMatch[1];
  else {
    const isoMatch = trimmed.match(ISO_REGEX);
    if (isoMatch) ts = isoMatch[1].replace(" ", "T").replace(/Z$|[+-]\d{2}:?\d{2}$/, (m) => (m ? m : "Z"));
  }
  if (!ts) return null;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d.getTime();
}

/** Parse --since "5m" | "1h" | "30m" into milliseconds */
function parseSince(value: string): number {
  const m = value.match(/^(\d+)(m|h|s)$/i);
  if (!m) throw new Error(`Invalid --since format: ${value}. Use e.g. 5m, 1h, 30s`);
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  if (unit === "s") return n * 1000;
  if (unit === "m") return n * 60 * 1000;
  if (unit === "h") return n * 60 * 60 * 1000;
  throw new Error(`Invalid --since unit: ${unit}`);
}

/** Parse --from / --to into Date */
function parseTime(value: string, refDate: Date): Date {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return new Date(trimmed);
  if (/^\d{1,2}:\d{2}(?::\d{2})?/.test(trimmed)) {
    const [h, m, s = "0"] = trimmed.split(":");
    const d = new Date(refDate);
    d.setHours(parseInt(h, 10), parseInt(m, 10), parseInt(s, 10), 0);
    return d;
  }
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) throw new Error(`Invalid time format: ${value}`);
  return d;
}

/**
 * Filter raw log lines by time window.
 * - tail: applied first (last N lines), then time filter if specified
 * - since: keep lines within last N ms from latest timestamp in data
 * - from/to: keep lines between absolute times
 */
export function filterByTimeWindow(
  lines: RawLogLine[],
  opts: TimeFilterOptions
): RawLogLine[] {
  if (lines.length === 0) return lines;

  let result = lines;

  if (opts.tail != null && opts.tail > 0) {
    result = result.slice(-opts.tail);
  }

  if (!opts.since && !opts.from && !opts.to) return result;

  const withTs = result.map((r) => ({ raw: r, ms: extractTimestampMs(r.line) }));
  const withValidTs = withTs.filter((x) => x.ms != null) as { raw: RawLogLine; ms: number }[];
  const unknownTs = withTs.filter((x) => x.ms == null).map((x) => x.raw);

  if (withValidTs.length === 0) return result;

  const refDate = new Date(Math.max(...withValidTs.map((x) => x.ms)));

  let minMs: number;
  let maxMs: number;

  if (opts.since) {
    const windowMs = parseSince(opts.since);
    minMs = refDate.getTime() - windowMs;
    maxMs = refDate.getTime() + 1000;
  } else if (opts.from || opts.to) {
    minMs = opts.from ? parseTime(opts.from, refDate).getTime() : 0;
    maxMs = opts.to ? parseTime(opts.to, refDate).getTime() : Number.MAX_SAFE_INTEGER;
  } else {
    return result;
  }

  const filtered = withValidTs
    .filter((x) => x.ms >= minMs && x.ms <= maxMs)
    .map((x) => x.raw);

  return [...filtered, ...unknownTs].sort((a, b) => a.lineNumber - b.lineNumber);
}
