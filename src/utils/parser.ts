/**
 * Parser entrypoint with registry-backed line parsing.
 * Keeps stable API for the engine while allowing pluggable parser expansion.
 */

import type { RawLogLine, ParsedEvent } from "./types.js";
import { parseLineWithRegistry } from "./parserRegistry.js";

export function parseLines(rawLines: RawLogLine[]): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  for (const raw of rawLines) {
    const parsed = parseLineWithRegistry(raw);
    if (parsed?.event) events.push(parsed.event);
  }
  return sortEventsByTime(events);
}

function sortEventsByTime(events: ParsedEvent[]): ParsedEvent[] {
  const lineOf = (event: ParsedEvent): number => event.lineNumber ?? Number.MAX_SAFE_INTEGER;
  const knownTs = events.filter((e) => e.timestamp !== "unknown").length;
  const timestampCoverage = events.length > 0 ? knownTs / events.length : 0;
  // If timestamp extraction is weak, preserve ingestion order for timeline fidelity.
  if (timestampCoverage < 0.7) {
    return [...events].sort((a, b) => lineOf(a) - lineOf(b));
  }
  return [...events].sort((a, b) => {
    if (a.timestamp === "unknown" && b.timestamp === "unknown") return lineOf(a) - lineOf(b);
    if (a.timestamp === "unknown") return 1;
    if (b.timestamp === "unknown") return -1;
    const diff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    return diff === 0 ? lineOf(a) - lineOf(b) : diff;
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
