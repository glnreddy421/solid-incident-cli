import type { ParsedIncidentEvent } from "../../contracts/index.js";

function shortTime(ts: string): string {
  if (!ts || ts === "unknown") return "unknown";
  try {
    return new Date(ts).toISOString().slice(11, 19);
  } catch {
    return ts;
  }
}

function eventPhrase(e: ParsedIncidentEvent): string {
  switch (e.normalizedType) {
    case "connection_refused":
      return "connection refused";
    case "timeout":
      return "timeout spike";
    case "retry":
      return "retry burst";
    case "restart_event":
      return "restart event";
    case "oom":
      return "memory pressure event";
    case "auth_failure":
      return "auth failure";
    case "latency_outlier":
      return "latency outlier";
    default:
      return e.severity === "info" ? "routine telemetry emitted" : "event observed";
  }
}

function shortSource(sourceName?: string): string {
  if (!sourceName) return "";
  const parts = sourceName.split(/[\\/]/);
  return parts[parts.length - 1] || sourceName;
}

export function reconstructAnnotatedTimeline(events: ParsedIncidentEvent[]): string[] {
  if (!events.length) return ["No events in analysis window."];
  const lines: string[] = [];
  const timestampCoverage = events.filter((e) => e.timestamp !== "unknown").length / events.length;
  const sorted = timestampCoverage >= 0.7
    ? [...events].sort((a, b) => {
        if (a.timestamp === "unknown") return 1;
        if (b.timestamp === "unknown") return -1;
        return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      })
    : [...events];

  lines.push(
    `Timeline summary: ${events.length} events | timestamp coverage ${Math.round(timestampCoverage * 100)}% | ordering ${timestampCoverage >= 0.7 ? "timestamp" : "input-sequence"}`
  );
  const sourceCount = new Set(sorted.map((e) => e.sourceName || e.source || "unknown")).size;
  if (sourceCount > 1) {
    lines.push(`Merged input sources: ${sourceCount} | chronology reconstructed across sources`);
  }
  lines.push("");

  type EventRun = { event: ParsedIncidentEvent; count: number; startSeq: number; endSeq: number };
  const runs: EventRun[] = [];
  let seq = 0;
  for (const e of sorted.slice(0, 220)) {
    seq += 1;
    const key = `${e.service}:${e.normalizedType}:${e.severity}:${e.sourceName ?? e.source ?? "unknown"}`;
    const current = runs[runs.length - 1];
    const currentKey = current
      ? `${current.event.service}:${current.event.normalizedType}:${current.event.severity}:${current.event.sourceName ?? current.event.source ?? "unknown"}`
      : "";
    if (current && currentKey === key) {
      current.count += 1;
      current.endSeq = seq;
      continue;
    }
    runs.push({ event: e, count: 1, startSeq: seq, endSeq: seq });
  }

  for (let i = 0; i < runs.length && lines.length < 42; i++) {
    const run = runs[i];
    const prev = i > 0 ? runs[i - 1] : undefined;
    const timeLabel = run.event.timestamp !== "unknown" ? shortTime(run.event.timestamp) : `seq#${String(run.startSeq).padStart(3, "0")}`;
    const sourceLabel = shortSource(run.event.sourceName);
    const sourceText = sourceLabel ? ` [${sourceLabel}]` : "";
    lines.push(`${timeLabel}${sourceText} ${run.event.service} ${eventPhrase(run.event)}`);
    if (run.count > 1) {
      lines.push(`  +${run.count - 1} similar events (seq#${String(run.startSeq).padStart(3, "0")}..${String(run.endSeq).padStart(3, "0")})`);
      // Keep chronology visual for long runs with deterministic checkpoints.
      if (run.count >= 20 && lines.length < 40) {
        const checkpoints = [0.25, 0.5, 0.75]
          .map((ratio) => run.startSeq + Math.floor(run.count * ratio))
          .filter((seqNo, idx, arr) => seqNo <= run.endSeq && arr.indexOf(seqNo) === idx);
        for (const seqNo of checkpoints) {
          lines.push(`    checkpoint seq#${String(seqNo).padStart(3, "0")} ${run.event.service} ${eventPhrase(run.event)}`);
          if (lines.length >= 40) break;
        }
      }
    }
    if (prev && (prev.event.service !== run.event.service || prev.event.normalizedType !== run.event.normalizedType)) {
      lines.push(`  -> transition: ${prev.event.service} -> ${run.event.service}`);
    }
  }

  if (!sorted.some((e) => e.severity === "warning" || e.severity === "error" || e.severity === "critical")) {
    lines.push("No abnormal transitions detected.");
  }
  return lines;
}

