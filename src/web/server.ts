import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { AnalysisResult, ParsedIncidentEvent, Signal, TimelineEntry } from "../contracts/index.js";
import { applyHeuristicReport } from "../reports/heuristicStructuredReports.js";
import {
  METRIC_HINT_EVENTS,
  METRIC_HINT_HEALTH,
  METRIC_HINT_SERVICES,
  METRIC_HINT_SUMMARY_CONFIDENCE,
  METRIC_HINT_VERDICT,
} from "../ui/metricHints.js";
import { markdownToSafeHtml } from "./markdownToHtml.js";
import {
  aiHasUsableContent,
  aiOrEngineTimelineNarrative,
  aiPrimaryHeadline,
  displayRecommendedLines,
  displayRootCauseLines,
} from "../utils/enrich/aiPresentation.js";

const DEFAULT_PORT = 3456;

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(typeof c === "string" ? Buffer.from(c) : c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Same ordering as overview / engine emphasis: score, then count. */
function sortSignalsForDisplay(signals: Signal[]): Signal[] {
  return [...signals].sort((a, b) => (b.score ?? b.count ?? 0) - (a.score ?? a.count ?? 0));
}

interface SignalEvidenceLineJson {
  eventIndex: number;
  timestamp: string;
  service: string;
  severity: string;
  message: string;
  lineNumber?: number;
  sourceName?: string;
  rawLine?: string;
}

interface SignalEvidenceBundleJson {
  label: string;
  hint?: string;
  lines: SignalEvidenceLineJson[];
}

function lineFromTimelineIndex(
  i: number,
  timeline: TimelineEntry[],
  parsed: ParsedIncidentEvent[] | undefined,
): SignalEvidenceLineJson {
  const t = timeline[i];
  const p = parsed?.[i];
  const msg = t.message.length > 600 ? `${t.message.slice(0, 597)}…` : t.message;
  const raw = p?.rawLine;
  const rawOut =
    raw && raw !== t.message ? (raw.length > 800 ? `${raw.slice(0, 797)}…` : raw) : undefined;
  return {
    eventIndex: i,
    timestamp: t.timestamp,
    service: t.service,
    severity: t.severity,
    message: msg,
    lineNumber: t.lineNumber,
    sourceName: p?.sourceName,
    rawLine: rawOut,
  };
}

/** Evidence + fallbacks for web drill-down; order matches `sortSignalsForDisplay` output. */
function buildSignalEvidenceBundles(result: AnalysisResult, ordered: Signal[]): SignalEvidenceBundleJson[] {
  const tl = result.timeline;
  const pe = result.parsedEvents;
  return ordered.map((sig) => {
    const idxs = (sig.supportingEventIndexes ?? []).filter((i) => Number.isInteger(i) && i >= 0 && i < tl.length);
    const uniqueIdx = [...new Set(idxs)].slice(0, 40);
    if (uniqueIdx.length > 0) {
      return {
        label: sig.label,
        lines: uniqueIdx.map((i) => lineFromTimelineIndex(i, tl, pe)),
      };
    }
    const svc = sig.service?.trim();
    if (svc) {
      const hits: number[] = [];
      for (let i = 0; i < tl.length && hits.length < 25; i++) {
        if (tl[i].service === svc) hits.push(i);
      }
      if (hits.length > 0) {
        return {
          label: sig.label,
          hint: `No direct line linkage stored; showing timeline events for service "${svc}".`,
          lines: hits.map((i) => lineFromTimelineIndex(i, tl, pe)),
        };
      }
    }
    if (sig.scoreSource === "tfidf") {
      const terms = sig.label
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length >= 3)
        .slice(0, 4);
      if (terms.length > 0) {
        const hits: number[] = [];
        for (let i = 0; i < tl.length && hits.length < 25; i++) {
          const blob = `${tl[i].message} ${tl[i].service}`.toLowerCase();
          if (terms.some((term) => blob.includes(term))) hits.push(i);
        }
        if (hits.length > 0) {
          return {
            label: sig.label,
            hint: "Similar log lines (message or service contains cluster terms).",
            lines: hits.map((i) => lineFromTimelineIndex(i, tl, pe)),
          };
        }
      }
    }
    return {
      label: sig.label,
      hint: "No line-level evidence for this signal. Open the Evidence tab for the full log window.",
      lines: [],
    };
  });
}

function formatMlScore(n: number): string {
  const x = Math.min(1, Math.max(0, n));
  return `${Math.round(x * 100)}%`;
}

function signalMetaChips(sig: Signal, esc: (s: string) => string): string {
  const chips: string[] = [];
  chips.push(
    `<span class="signal-chip signal-chip-sev signal-sev-${sig.severity}">${esc(sig.severity)}</span>`,
  );
  if (sig.count != null && sig.count > 0) {
    chips.push(`<span class="signal-chip signal-chip-neutral">${esc(String(sig.count))}× events</span>`);
  }
  if (sig.score != null) {
    chips.push(`<span class="signal-chip signal-chip-metric">Strength ${esc(String(sig.score))}</span>`);
  }
  if (sig.mlScore != null) {
    chips.push(
      `<span class="signal-chip signal-chip-ml">ML ${esc(formatMlScore(sig.mlScore))}</span>`,
    );
  }
  if (sig.scoreSource === "ml") {
    chips.push(`<span class="signal-chip signal-chip-src">ML</span>`);
  } else if (sig.scoreSource === "tfidf") {
    chips.push(`<span class="signal-chip signal-chip-src">TF‑IDF</span>`);
  }
  if (sig.service?.trim()) {
    chips.push(`<span class="signal-chip signal-chip-svc">${esc(sig.service.trim())}</span>`);
  }
  return chips.join("");
}

/** Full-width card for Signals tab */
function signalCardHtml(sig: Signal, rank: number, signalIndex: number, esc: typeof escapeHtml): string {
  const desc = sig.description?.trim()
    ? `<p class="signal-card-desc">${esc(sig.description.trim())}</p>`
    : "";
  return `<article class="signal-card signal-card-interactive signal-sev-${sig.severity}" data-signal-index="${signalIndex}" role="button" tabindex="0" aria-label="${esc(sig.label)} — show supporting log lines">
    <div class="signal-card-rank" aria-hidden="true">${rank}</div>
    <div class="signal-card-body">
      <h3 class="signal-card-title">${esc(sig.label)}</h3>
      <div class="signal-card-meta">${signalMetaChips(sig, esc)}</div>
      ${desc}
      <p class="signal-card-hint" aria-hidden="true">Click for evidence</p>
    </div>
  </article>`;
}

/** Compact tile for Summary tab */
function signalMiniTileHtml(sig: Signal, esc: typeof escapeHtml, signalIndex: number): string {
  const sub =
    [sig.count != null && sig.count > 0 ? `${sig.count}×` : null, sig.score != null ? `· ${sig.score}` : null]
      .filter(Boolean)
      .join(" ") || sig.severity;
  return `<div class="signal-mini signal-mini-interactive signal-sev-${sig.severity}" data-signal-index="${signalIndex}" role="button" tabindex="0" title="${esc(sig.description ?? sig.label)}" aria-label="${esc(sig.label)} — show supporting log lines">
    <span class="signal-mini-label">${esc(sig.label)}</span>
    <span class="signal-mini-sub">${esc(sub)}</span>
  </div>`;
}

function buildHtml(result: AnalysisResult): string {
  const esc = escapeHtml;
  const s = result.summary;
  const a = result.assessment;
  const ai = result.ai;
  const byoNoticeCard = ai.byoProviderNotice?.trim()
    ? `<div class="card byo-notice-card"><div class="card-title">Bring-your-own LLM</div><div class="card-body"><p class="ai-status-note" style="text-align:left;margin:0;line-height:1.55">${esc(ai.byoProviderNotice.trim())}</p></div></div>`
    : "";
  const preferAi = aiHasUsableContent(ai);
  const summaryNarrativeHtml = preferAi
    ? markdownToSafeHtml([aiPrimaryHeadline(ai), ai.operatorNarrative?.trim()].filter(Boolean).join("\n\n"))
    : markdownToSafeHtml(a.summaryNarrative || s.incidentSummary || "No incident summary available.");
  const nextActionsHtml = preferAi
    ? displayRecommendedLines(ai, a.recommendedActions)
        .map((block) => `<li class="prose-li">${markdownToSafeHtml(block)}</li>`)
        .join("")
    : a.recommendedActions
        .slice(0, 5)
        .map((x) => `<li class="prose-li">${markdownToSafeHtml(x)}</li>`)
        .join("");
  const rootCauseSummaryHtml = preferAi
    ? displayRootCauseLines(ai, a.rootCauseCandidates)
        .map((block) => `<li class="prose-li">${markdownToSafeHtml(block)}</li>`)
        .join("")
    : a.rootCauseCandidates
        .slice(0, 4)
        .map((r) => `<li class="prose-li">${markdownToSafeHtml(`**${r.id}** (${Math.round(r.confidence * 100)}%) — ${r.evidence}`)}</li>`)
        .join("");
  const signalsSorted = sortSignalsForDisplay(result.signals);
  const signalEvidenceJson = buildSignalEvidenceBundles(result, signalsSorted);
  const topSignals = signalsSorted.slice(0, 8);
  const signalCount = result.signals.length;
  const signalUrgent = result.signals.filter((s) => s.severity === "critical" || s.severity === "error").length;
  const signalWarn = result.signals.filter((s) => s.severity === "warning").length;
  const signalWithMl = result.signals.filter((s) => s.mlScore != null || s.scoreSource === "ml").length;
  const signalsPanelInner =
    signalCount === 0
      ? `<div class="signals-empty">
          <div class="signals-empty-visual" aria-hidden="true">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="1.5" opacity="0.35"/><path d="M24 14v10l6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/></svg>
          </div>
          <p class="signals-empty-title">No signals detected</p>
          <p class="signals-empty-hint">Signals appear when the engine finds patterns such as errors, retries, timeouts, or clusters in your logs.</p>
        </div>`
      : `<div class="signals-dashboard">
          <div class="signals-kpi-row">
            <div class="signals-kpi"><span class="signals-kpi-value">${signalCount}</span><span class="signals-kpi-label">Total</span></div>
            <div class="signals-kpi signals-kpi-urgent"><span class="signals-kpi-value">${signalUrgent}</span><span class="signals-kpi-label">Critical / error</span></div>
            <div class="signals-kpi signals-kpi-warn"><span class="signals-kpi-value">${signalWarn}</span><span class="signals-kpi-label">Warnings</span></div>
            <div class="signals-kpi signals-kpi-ml"><span class="signals-kpi-value">${signalWithMl}</span><span class="signals-kpi-label">With ML / blend</span></div>
          </div>
          <p class="signals-lede">Ranked by engine strength (score / event support). <strong>Click a signal</strong> to see supporting log lines (or similar lines when the engine did not store direct indexes).</p>
          <div class="signals-grid" role="list">${signalsSorted.map((sig, i) => signalCardHtml(sig, i + 1, i, esc)).join("")}</div>
        </div>`;
  const strongestStrip =
    topSignals.length === 0
      ? '<p class="signals-strip-empty">No signals in this run.</p>'
      : `<div class="signals-strip" role="list">${topSignals.map((sig, i) => signalMiniTileHtml(sig, esc, i)).join("")}</div>`;
  const traceEdges =
    result.traceGraph?.edges?.length > 0
      ? result.traceGraph.edges
      : result.flow.map((e) => ({ from: e.from, to: e.to, annotation: "impact", count: e.count, confidence: e.confidence }));
  const hr = result.heuristicReports;
  const hrExisting =
    hr?.rca || hr?.interview
      ? `<p class="ai-status-note" style="text-align:left;margin:0 0 0.75rem">Snapshots already on this run: ${[
          hr.rca ? `RCA (${esc(hr.rca.generatedAt)})` : "",
          hr.interview ? `STAR (${esc(hr.interview.generatedAt)})` : "",
        ]
          .filter(Boolean)
          .join(" · ")} — included in <code>/api/analysis</code> as <code>heuristicReports</code>. Generate replaces that kind.</p>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SOLIDX — Incident Analysis</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0d1117; --bg-elevated: #161b22; --bg-card: #21262d;
      --fg: #e6edf3; --fg-muted: #8b949e; --border: #30363d;
      --accent: #58a6ff; --accent-dim: rgba(88,166,255,0.15);
      --success: #3fb950; --success-dim: rgba(63,185,80,0.15);
      --warn: #d29922; --warn-dim: rgba(210,153,34,0.15);
      --danger: #f85149; --danger-dim: rgba(248,81,73,0.15);
      --amber: #e3b341; --purple: #a371f7;
      --radius: 8px; --radius-sm: 6px; --shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    * { box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 0; line-height: 1.6; min-height: 100vh; }
    .app { max-width: 1200px; margin: 0 auto; padding: 1.5rem; }
    .header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border); }
    .logo { font-family: 'JetBrains Mono', monospace; font-size: 1.5rem; font-weight: 600; color: var(--amber); letter-spacing: -0.02em; }
    .stats { display: flex; gap: 0.75rem; flex-wrap: wrap; }
    .stat-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 0.75rem 1rem; min-width: 140px; max-width: 220px; }
    .stat-hint { font-size: 0.62rem; font-weight: 400; color: var(--fg-muted); line-height: 1.4; margin-top: 0.45rem; text-transform: none; letter-spacing: 0.02em; }
    .stat-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--fg-muted); margin-bottom: 0.25rem; }
    .stat-value { font-family: 'JetBrains Mono', monospace; font-size: 0.9rem; font-weight: 500; }
    .stat-card.confidence .stat-value { color: var(--success); }
    .stat-card.trigger .stat-value { color: var(--danger); font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
    .tabs { display: flex; gap: 0.25rem; flex-wrap: wrap; margin-bottom: 1.5rem; padding: 0.25rem; background: var(--bg-elevated); border-radius: var(--radius); border: 1px solid var(--border); }
    .tab { padding: 0.5rem 1rem; background: transparent; border: none; border-radius: var(--radius-sm); cursor: pointer; font-size: 0.85rem; font-weight: 500; color: var(--fg-muted); transition: all 0.15s ease; }
    .tab:hover { color: var(--fg); background: var(--bg-card); }
    .tab.active { background: var(--accent); color: var(--bg); }
    .panel { display: none; animation: fadeIn 0.2s ease; }
    .panel.active { display: block; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.25rem; margin-bottom: 1rem; }
    .card-title { font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--fg-muted); margin-bottom: 0.75rem; }
    .card-body { font-size: 0.95rem; }
    .summary-text { font-size: 1rem; line-height: 1.7; color: var(--fg); }
    .trigger-box { background: var(--danger-dim); border: 1px solid rgba(248,81,73,0.3); border-radius: var(--radius-sm); padding: 1rem; font-family: 'JetBrains Mono', monospace; font-size: 0.9rem; margin: 0.25rem 0; }
    .action-list { list-style: none; padding: 0; margin: 0; }
    .action-list li { padding: 0.5rem 0; padding-left: 1.5rem; position: relative; border-bottom: 1px solid var(--border); }
    .action-list li:last-child { border-bottom: none; }
    .action-list li::before { content: "→"; position: absolute; left: 0; color: var(--accent); font-weight: 600; }
    .action-list li.prose-li::before { content: none; }
    .action-list li.prose-li { padding-left: 0; border-bottom: 1px solid var(--border); }
    .signals-strip { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: stretch; }
    .signals-strip-empty { margin: 0; font-size: 0.9rem; color: var(--fg-muted); }
    .signal-mini { flex: 1 1 160px; max-width: 220px; min-width: 140px; padding: 0.65rem 0.85rem; border-radius: var(--radius-sm); background: var(--bg-elevated); border: 1px solid var(--border); border-left-width: 3px; display: flex; flex-direction: column; gap: 0.2rem; transition: border-color 0.15s ease, box-shadow 0.15s ease; }
    .signal-mini:hover { box-shadow: var(--shadow); }
    .signal-mini.signal-sev-critical, .signal-mini.signal-sev-error { border-left-color: var(--danger); }
    .signal-mini.signal-sev-warning { border-left-color: var(--warn); }
    .signal-mini.signal-sev-info { border-left-color: var(--accent); }
    .signal-mini.signal-sev-debug { border-left-color: var(--fg-muted); }
    .signal-mini-label { font-weight: 600; font-size: 0.82rem; line-height: 1.3; color: var(--fg); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .signal-mini-sub { font-family: 'JetBrains Mono', monospace; font-size: 0.72rem; color: var(--fg-muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .signals-dashboard { margin: -0.25rem 0 0; }
    .signals-kpi-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.75rem; margin-bottom: 1.25rem; }
    @media (max-width: 720px) { .signals-kpi-row { grid-template-columns: repeat(2, 1fr); } }
    .signals-kpi { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.85rem 1rem; text-align: center; }
    .signals-kpi-value { display: block; font-family: 'JetBrains Mono', monospace; font-size: 1.35rem; font-weight: 600; color: var(--fg); line-height: 1.2; }
    .signals-kpi-label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--fg-muted); margin-top: 0.35rem; display: block; }
    .signals-kpi-urgent .signals-kpi-value { color: var(--danger); }
    .signals-kpi-warn .signals-kpi-value { color: var(--warn); }
    .signals-kpi-ml .signals-kpi-value { color: var(--purple); }
    .signals-lede { font-size: 0.85rem; color: var(--fg-muted); margin: 0 0 1rem; line-height: 1.5; }
    .signals-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: 1rem; }
    .signal-card { position: relative; display: flex; gap: 0; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; transition: box-shadow 0.2s ease, border-color 0.2s ease; }
    .signal-card-interactive { cursor: pointer; }
    .signal-card-interactive:hover { box-shadow: var(--shadow); border-color: rgba(88,166,255,0.25); }
    .signal-card-interactive:focus { outline: 2px solid var(--accent); outline-offset: 2px; }
    .signal-card-hint { margin: 0.65rem 0 0; font-size: 0.72rem; color: var(--fg-muted); letter-spacing: 0.02em; }
    .signal-mini-interactive { cursor: pointer; }
    .signal-mini-interactive:focus { outline: 2px solid var(--accent); outline-offset: 2px; }
    .signal-modal { display: none; position: fixed; inset: 0; z-index: 300; align-items: flex-start; justify-content: center; padding: 1.5rem; box-sizing: border-box; }
    .signal-modal.open { display: flex; }
    .signal-modal-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.72); cursor: pointer; }
    .signal-modal-panel { position: relative; z-index: 1; width: min(720px, 100%); max-height: min(85vh, 900px); margin-top: 4vh; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius); display: flex; flex-direction: column; box-shadow: 0 16px 48px rgba(0,0,0,0.45); }
    .signal-modal-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); flex-shrink: 0; }
    .signal-modal-title { margin: 0; font-size: 1.05rem; font-weight: 600; line-height: 1.35; word-break: break-word; }
    .signal-modal-close { flex-shrink: 0; background: none; border: none; color: var(--fg-muted); font-size: 1.65rem; line-height: 1; cursor: pointer; padding: 0 0.25rem; border-radius: 4px; }
    .signal-modal-close:hover { color: var(--fg); background: var(--bg-card); }
    .signal-modal-hint { display: none; padding: 0.65rem 1.25rem; font-size: 0.82rem; color: var(--amber); line-height: 1.45; border-bottom: 1px solid var(--border); background: rgba(227,179,65,0.08); }
    .signal-modal-hint.show { display: block; }
    .signal-modal-body { overflow: auto; padding: 1rem 1.25rem 1.25rem; flex: 1; min-height: 0; }
    .signal-ev-line { font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; padding: 0.65rem 0.75rem; margin: 0.4rem 0; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); line-height: 1.45; }
    .signal-ev-meta { font-size: 0.68rem; color: var(--fg-muted); margin-bottom: 0.4rem; text-transform: none; letter-spacing: 0; }
    .signal-ev-raw { margin-top: 0.5rem; font-size: 0.72rem; opacity: 0.92; white-space: pre-wrap; word-break: break-word; }
    .signal-card::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--border); }
    .signal-card.signal-sev-critical::before, .signal-card.signal-sev-error::before { background: linear-gradient(180deg, var(--danger), #ff6b6b); }
    .signal-card.signal-sev-warning::before { background: linear-gradient(180deg, var(--warn), #e3b341); }
    .signal-card.signal-sev-info::before { background: linear-gradient(180deg, var(--accent), var(--purple)); }
    .signal-card.signal-sev-debug::before { background: var(--fg-muted); }
    .signal-card-rank { flex-shrink: 0; width: 2.5rem; display: flex; align-items: center; justify-content: center; font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; font-weight: 600; color: var(--fg-muted); background: rgba(0,0,0,0.2); border-right: 1px solid var(--border); }
    .signal-card-body { flex: 1; padding: 1rem 1.1rem; min-width: 0; }
    .signal-card-title { margin: 0 0 0.55rem; font-size: 0.95rem; font-weight: 600; line-height: 1.35; color: var(--fg); word-break: break-word; }
    .signal-card-meta { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 0.35rem; }
    .signal-chip { display: inline-flex; align-items: center; font-size: 0.65rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.22rem 0.5rem; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--fg-muted); }
    .signal-chip-sev.signal-sev-critical, .signal-chip-sev.signal-sev-error { color: var(--danger); border-color: rgba(248,81,73,0.45); background: var(--danger-dim); }
    .signal-chip-sev.signal-sev-warning { color: var(--warn); border-color: rgba(210,153,34,0.45); background: var(--warn-dim); }
    .signal-chip-sev.signal-sev-info { color: var(--accent); border-color: rgba(88,166,255,0.4); background: var(--accent-dim); }
    .signal-chip-sev.signal-sev-debug { color: var(--fg-muted); }
    .signal-chip-metric { color: var(--amber); border-color: rgba(227,179,65,0.35); }
    .signal-chip-ml { color: var(--purple); border-color: rgba(163,113,247,0.4); background: rgba(163,113,247,0.08); }
    .signal-chip-src { font-weight: 500; letter-spacing: 0.03em; }
    .signal-chip-svc { font-family: 'JetBrains Mono', monospace; font-size: 0.62rem; text-transform: none; letter-spacing: 0; color: var(--accent); border-color: rgba(88,166,255,0.35); }
    .signal-chip-neutral { text-transform: none; letter-spacing: 0.02em; font-weight: 500; }
    .signal-card-desc { margin: 0.5rem 0 0; font-size: 0.85rem; line-height: 1.55; color: var(--fg-muted); }
    .signals-empty { text-align: center; padding: 2.5rem 1.5rem; color: var(--fg-muted); }
    .signals-empty-visual { color: var(--border); margin-bottom: 1rem; }
    .signals-empty-title { font-size: 1.05rem; font-weight: 600; color: var(--fg); margin: 0 0 0.5rem; }
    .signals-empty-hint { font-size: 0.88rem; line-height: 1.55; max-width: 28rem; margin: 0 auto; }
    .timeline-entry { padding: 0.6rem 1rem; border-radius: var(--radius-sm); margin: 0.25rem 0; font-family: 'JetBrains Mono', monospace; font-size: 0.82rem; }
    .timeline-entry { background: var(--bg-elevated); border: 1px solid var(--border); }
    .timeline-entry.trigger { background: var(--danger-dim); border-color: var(--danger); }
    .timeline-entry.anomaly { background: var(--warn-dim); border-color: var(--warn); }
    .severity { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; padding: 0.15rem 0.4rem; border-radius: 4px; margin-right: 0.5rem; }
    .severity-error, .severity-critical { color: var(--danger); background: var(--danger-dim); }
    .severity-warning { color: var(--warn); background: var(--warn-dim); }
    .severity-info { color: var(--accent); background: var(--accent-dim); }
    .severity-debug { color: var(--fg-muted); background: var(--bg-card); }
    .flow-card { display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1rem; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); margin: 0.5rem 0; }
    .flow-arrow { color: var(--accent); font-weight: 600; }
    .flow-meta { font-size: 0.75rem; color: var(--fg-muted); margin-left: auto; }
    pre, .code-block { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 1rem; overflow-x: auto; font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; line-height: 1.5; white-space: pre-wrap; }
    .empty-state { text-align: center; padding: 2rem; color: var(--fg-muted); }
    .empty-state-icon { font-size: 2rem; margin-bottom: 0.5rem; opacity: 0.5; }
    @keyframes ai-spin { to { transform: rotate(360deg); } }
    .ai-spinner { width: 28px; height: 28px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: ai-spin 0.75s linear infinite; margin: 0 auto 1rem; }
    .ai-status-note { font-size: 0.85rem; color: var(--fg-muted); max-width: 36rem; margin: 0 auto; line-height: 1.5; }
    .trace-graph-container { min-height: 400px; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.5rem; }
    .trace-graph-container { display: flex; align-items: center; justify-content: center; }
    .trace-graph-container svg { max-width: 100%; }
    .report-btn { padding: 0.55rem 1.1rem; background: var(--accent); color: var(--bg); border: none; border-radius: var(--radius-sm); font-weight: 600; cursor: pointer; font-size: 0.85rem; }
    .report-btn:hover { filter: brightness(1.08); }
    .report-btn.secondary { background: var(--bg-elevated); color: var(--fg); border: 1px solid var(--border); }
    .report-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .prose-wrap .prose-doc, .prose-wrap.prose-doc { font-size: 0.95rem; line-height: 1.65; color: var(--fg); }
    .prose-doc .prose-heading { margin: 1.15rem 0 0.5rem; font-weight: 600; color: var(--fg); line-height: 1.3; }
    .prose-doc .prose-heading:first-child { margin-top: 0; }
    .prose-doc h2.prose-heading { font-size: 1.15rem; border-bottom: 1px solid var(--border); padding-bottom: 0.35rem; }
    .prose-doc h3.prose-heading { font-size: 1.05rem; color: var(--accent); }
    .prose-doc h4.prose-heading { font-size: 0.95rem; color: var(--fg-muted); }
    .prose-doc .prose-p { margin: 0.5rem 0; color: var(--fg); }
    .prose-doc .prose-list { margin: 0.5rem 0 0.75rem 1.1rem; padding: 0; color: var(--fg); }
    .prose-doc .prose-list li { margin: 0.35rem 0; }
    .prose-doc .prose-quote { margin: 0.75rem 0; padding: 0.65rem 1rem; border-left: 3px solid var(--accent); background: var(--accent-dim); border-radius: 0 var(--radius-sm) var(--radius-sm) 0; color: var(--fg-muted); }
    .prose-doc .prose-quote p { margin: 0.35rem 0; }
    .prose-doc .prose-hr { border: none; border-top: 1px solid var(--border); margin: 1rem 0; }
    .prose-doc .prose-code { font-family: 'JetBrains Mono', monospace; font-size: 0.82em; background: var(--bg); padding: 0.12rem 0.35rem; border-radius: 4px; border: 1px solid var(--border); color: var(--amber); }
    li.prose-li { list-style: none; padding: 0.65rem 0; padding-left: 0; border-bottom: 1px solid var(--border); }
    li.prose-li:last-child { border-bottom: none; }
    li.prose-li .prose-doc { margin: 0; }
    .report-render-shell { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.25rem 1.5rem; margin-top: 0.75rem; max-height: 70vh; overflow: auto; }
    .report-toolbar { align-items: center; }
    @media print {
      body { background: #fff !important; color: #111 !important; }
      .header, nav.tabs, .tab, .no-print { display: none !important; }
      .panel { display: none !important; }
      #panel-reports.panel { display: block !important; }
      #panel-reports .card { box-shadow: none; border: none; }
      #report-print-root { display: block !important; max-height: none !important; overflow: visible !important; }
      #report-rendered { border: none !important; background: #fff !important; max-height: none !important; }
      .prose-doc, .prose-doc .prose-p { color: #111 !important; }
      .prose-doc .prose-heading { color: #000 !important; border-color: #ccc !important; }
      .prose-doc .prose-code { background: #f0f0f0 !important; color: #222 !important; }
    }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
</head>
<body>
  <div class="app">
    <header class="header">
      <div class="logo">SOLIDX</div>
      <div class="stats">
        <div class="stat-card confidence"><div class="stat-label">Confidence</div><div class="stat-value">${s.confidence}%</div><div class="stat-hint">${esc(METRIC_HINT_SUMMARY_CONFIDENCE)}</div></div>
        <div class="stat-card"><div class="stat-label">Verdict</div><div class="stat-value">${esc(a.verdict)}</div><div class="stat-hint">${esc(METRIC_HINT_VERDICT)}</div></div>
        <div class="stat-card"><div class="stat-label">Health</div><div class="stat-value">${a.healthScore}/100</div><div class="stat-hint">${esc(METRIC_HINT_HEALTH)}</div></div>
        <div class="stat-card"><div class="stat-label">Events</div><div class="stat-value">${result.timeline.length}</div><div class="stat-hint">${esc(METRIC_HINT_EVENTS)}</div></div>
        <div class="stat-card"><div class="stat-label">Services</div><div class="stat-value">${esc(s.affectedServices.join(", ") || "—")}</div><div class="stat-hint">${esc(METRIC_HINT_SERVICES)}</div></div>
        <div class="stat-card trigger"><div class="stat-label">Trigger</div><div class="stat-value" title="${esc(s.triggerEvent)}">${esc(s.triggerEvent)}</div></div>
      </div>
    </header>

    <nav class="tabs">
      <button class="tab active" data-panel="summary">Summary</button>
      <button class="tab" data-panel="timeline">Timeline</button>
      <button class="tab" data-panel="trace-graph">Trace Graph</button>
      <button class="tab" data-panel="mindmap">Mind Map</button>
      <button class="tab" data-panel="signals">Signals</button>
      <button class="tab" data-panel="evidence">Evidence</button>
      <button class="tab" data-panel="ai-analysis">AI interpretation</button>
      <button class="tab" data-panel="reports">Reports</button>
      <button class="tab" data-panel="diagnostics">Diagnostics</button>
    </nav>

    <div id="panel-summary" class="panel active">
      <div class="card"><div class="card-title">Incident verdict</div><div class="card-body"><div><strong>${esc(a.verdict)}</strong></div><div>Severity: ${esc(a.severity)}</div><div>Reason: ${esc(a.verdictReason)}</div></div></div>
      <div class="card"><div class="card-title">What happened</div><div class="card-body summary-text prose-wrap">${summaryNarrativeHtml}</div></div>
      <div class="card"><div class="card-title">Trigger candidate</div><div class="trigger-box">Service: ${esc(a.triggerService)}<br>Event: ${esc(a.triggerEvent)}<br>PID: ${esc(a.triggerPid ?? "-")}<br>Host: ${esc(a.triggerHost ?? "-")}<br>Timestamp: ${esc(a.triggerTimestamp)}<br>Classification: ${esc(a.triggerClassification)}<br>Impact: ${esc(a.triggerImpact)}</div></div>
      <div class="card"><div class="card-title">Event distribution</div><div class="card-body">info ${a.eventDistribution.info} | warn ${a.eventDistribution.warn} | error ${a.eventDistribution.error} | anomaly ${a.eventDistribution.anomaly}</div></div>
      <div class="card"><div class="card-title">System health summary</div><ul class="action-list">${a.systemHealthSummary.slice(0, 5).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      <div class="card"><div class="card-title">${preferAi ? "Next best actions (AI-ranked)" : "Next best actions"}</div><ul class="action-list">${nextActionsHtml || '<li class="empty-state">—</li>'}</ul></div>
      <div class="card"><div class="card-title">Strongest signals</div>${strongestStrip}</div>
      <div class="card"><div class="card-title">${preferAi ? "Root cause (AI + engine)" : "Root cause candidates"}</div><ul class="action-list">${rootCauseSummaryHtml || '<li class="empty-state">—</li>'}</ul></div>
    </div>

    <div id="panel-timeline" class="panel">
      <div class="card"><div class="card-title">Timeline · ${result.timeline.length} events</div>${(a.reconstructedTimeline?.length ? a.reconstructedTimeline : result.timeline.map((e) => `${e.timestamp} ${e.service} ${e.message}`)).slice(0, 100).map((line) => `<div class="timeline-entry">${esc(line)}</div>`).join("")}${(a.reconstructedTimeline?.length ?? 0) > 100 ? `<p class="empty-state">… and ${(a.reconstructedTimeline?.length ?? 0) - 100} more events</p>` : ""}</div></div>
    </div>

    <div id="panel-trace-graph" class="panel">
      <div class="card"><div class="card-title">Trace map</div><div class="trace-graph-container" id="trace-graph"></div></div>
    </div>

    <div id="panel-mindmap" class="panel">
      <div class="card"><div class="card-title">Mind map</div><div class="trace-graph-container" id="mindmap-graph"></div></div>
    </div>

    <div id="panel-signals" class="panel">
      <div class="card"><div class="card-title">Signal intelligence</div><div class="card-body">${signalsPanelInner}</div></div></div>
    </div>

    <div id="panel-evidence" class="panel">
      <div class="card"><div class="card-title">Evidence</div><pre>${result.rawEvents.slice(0, 30).map((e, i) => `${i + 1}. ${e.host ? `[${e.host}] ` : ""}${e.service} [${e.severity}] ${e.timestamp}: ${e.message}`).join("\n")}</pre></div>
    </div>

    <div id="panel-ai-analysis" class="panel">
      ${byoNoticeCard}
      ${
        ai.enrichmentLoading
          ? `<div class="card"><div class="card-title">AI interpretation</div><div class="card-body"><div class="ai-spinner" aria-hidden="true"></div><p class="empty-state" style="padding-top:0">Contacting the backend…</p><p class="ai-status-note">Ollama can take a while. Other tabs already show local analysis. This page will refresh when enrichment finishes.</p></div></div>`
          : ai.enrichmentPending
            ? `<div class="card"><div class="card-title">AI interpretation</div><div class="card-body"><div class="ai-spinner" aria-hidden="true"></div><p class="empty-state" style="padding-top:0">Starting enrichment…</p><p class="ai-status-note">You can use Summary, Timeline, and other tabs while this runs.</p></div></div>`
            : !ai.available
          ? `<div class="card"><div class="card-title">AI interpretation</div><div class="card-body"><p class="empty-state">${esc(ai.warning ?? "AI unavailable.")}</p></div></div>`
            : !preferAi
            ? `<div class="card"><div class="card-title">AI interpretation</div><div class="card-body prose-wrap">${markdownToSafeHtml(ai.summary || "Little or no enrichment returned.")}<p class="ai-status-note" style="margin-top:1rem">${esc(ai.warning || "Use Summary / engine panels for the full picture.")}</p></div></div>`
            : `<div class="card"><div class="card-title">How to read this</div><div class="card-body"><p class="ai-status-note" style="text-align:left;margin:0;line-height:1.55">The LLM <strong>communicates</strong> findings from the engine’s structured payload — plain-language summary, narrative, and suggested checks. It does <strong>not</strong> replace deterministic analysis. For a full <strong>engine-only RCA</strong>, use the <strong>Reports</strong> tab → Generate RCA.</p></div></div>
      <div class="card"><div class="card-title">Operator briefing</div><div class="card-body prose-wrap">${markdownToSafeHtml(aiPrimaryHeadline(ai))}</div></div>
      ${ai.operatorNarrative?.trim() ? `<div class="card"><div class="card-title">On-call narrative</div><div class="card-body prose-wrap">${markdownToSafeHtml(ai.operatorNarrative.trim())}</div></div>` : ""}
      <div class="card"><div class="card-title">Timeline (AI)</div><div class="card-body prose-wrap">${markdownToSafeHtml(aiOrEngineTimelineNarrative(ai, a.summaryNarrative || s.incidentSummary || ""))}</div></div>
      ${ai.confidenceStatement?.trim() ? `<div class="card"><div class="card-title">Confidence</div><div class="card-body prose-wrap">${markdownToSafeHtml(ai.confidenceStatement.trim())}</div></div>` : ""}
      <div class="card"><div class="card-title">Ranked hypotheses</div><ul class="action-list">${displayRootCauseLines(ai, a.rootCauseCandidates).map((b) => `<li class="prose-li">${markdownToSafeHtml(b)}</li>`).join("")}</ul></div>
      <div class="card"><div class="card-title">Recommended checks</div><ul class="action-list">${displayRecommendedLines(ai, a.recommendedActions).map((b) => `<li class="prose-li">${markdownToSafeHtml(b)}</li>`).join("")}</ul></div>
      ${ai.followUpQuestions?.length ? `<div class="card"><div class="card-title">Follow-up questions</div><ul class="action-list">${ai.followUpQuestions.map((q) => `<li class="prose-li">${markdownToSafeHtml(q)}</li>`).join("")}</ul></div>` : ""}
      ${ai.caveats?.length ? `<div class="card"><div class="card-title">Caveats</div><ul class="action-list">${ai.caveats.map((c) => `<li class="prose-li">${markdownToSafeHtml(c)}</li>`).join("")}</ul></div>` : ""}
      ${
        (ai.followUpArtifacts ?? []).length
          ? `<div class="card"><div class="card-title">Explicit follow-ups (BYO)</div><div class="card-body">${(ai.followUpArtifacts ?? [])
              .map(
                (art) =>
                  `<div class="report-render-shell" style="margin-bottom:1rem;padding:1rem"><div class="card-title" style="margin-bottom:0.75rem">${esc(art.style)} · ${esc(art.generatedAt)}</div><div class="prose-wrap">${markdownToSafeHtml(art.content)}</div></div>`,
              )
              .join("")}</div></div>`
          : ""
      }
`
      }
    </div>

    <div id="panel-reports" class="panel">
      <div class="card">
        <div class="card-title">RCA & STAR interview — engine-only</div>
        <div class="card-body">
          <p class="ai-status-note" style="text-align:left;margin:0 0 1rem"><strong>Heuristic / structured reports only</strong> — topology, multi-factor scoring, signals, timelines, and assessment. <strong>Does not use AI enrichment</strong> (safe before or without AI). No model call when you press Generate.</p>
          ${hrExisting}
          <div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.75rem" class="no-print">
            <button type="button" class="report-btn" data-report="rca">Generate RCA</button>
            <button type="button" class="report-btn" data-report="interview">Generate interview (STAR)</button>
          </div>
          <div id="report-toolbar" class="report-toolbar no-print" style="display:none;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.5rem">
            <button type="button" class="report-btn secondary" id="report-copy" disabled>Copy Markdown</button>
            <button type="button" class="report-btn secondary" id="report-dl-md" disabled>Download .md</button>
            <button type="button" class="report-btn secondary" id="report-print" disabled>Save as PDF…</button>
          </div>
          <p id="report-status" class="ai-status-note no-print" style="text-align:left;min-height:1.25rem"></p>
          <div id="report-print-root" style="display:none">
            <div id="report-rendered" class="report-render-shell prose-wrap"></div>
          </div>
        </div>
      </div>
    </div>

    <div id="panel-diagnostics" class="panel">
      <div class="card"><div class="card-title">Diagnostics</div><div class="stats" style="margin-bottom:1rem"><div class="stat-card"><div class="stat-label">Warnings</div><div class="stat-value">${result.diagnostics.warnings.length}</div></div><div class="stat-card"><div class="stat-label">Errors</div><div class="stat-value">${result.diagnostics.errors.length}</div></div></div>${result.diagnostics.warnings.length ? `<ul class="action-list">${result.diagnostics.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}${result.diagnostics.errors.length ? `<ul class="action-list">${result.diagnostics.errors.map((e) => `<li style="color:var(--danger)">${esc(e)}</li>`).join("")}</ul>` : ""}</div>
    </div>
  </div>

  <div id="signal-evidence-modal" class="signal-modal no-print" role="dialog" aria-modal="true" aria-labelledby="signal-evidence-title">
    <div class="signal-modal-backdrop" data-close-signal-modal aria-hidden="true"></div>
    <div class="signal-modal-panel">
      <div class="signal-modal-header">
        <h2 id="signal-evidence-title" class="signal-modal-title"></h2>
        <button type="button" class="signal-modal-close" data-close-signal-modal aria-label="Close">&times;</button>
      </div>
      <div id="signal-evidence-hint" class="signal-modal-hint"></div>
      <div id="signal-evidence-body" class="signal-modal-body"></div>
    </div>
  </div>

  <script>
    const traceData = ${JSON.stringify(traceEdges)};
    const signalEvidence = ${JSON.stringify(signalEvidenceJson)};
    const mindmapData = ${JSON.stringify({
      summary: preferAi ? aiPrimaryHeadline(ai) || s.incidentSummary : s.incidentSummary || "No summary",
      trigger: s.triggerEvent,
      services: s.affectedServices,
      signals: result.signals.slice(0, 8).map((x) => ({ label: x.label, severity: x.severity })),
      rootCauses: preferAi
        ? displayRootCauseLines(ai, a.rootCauseCandidates).map((b) => b.split("\n")[0])
        : ai.rootCauseCandidates || [],
      actions: preferAi
        ? displayRecommendedLines(ai, a.recommendedActions).map((b) => b.split("\n")[0])
        : ai.recommendedChecks?.slice(0, 5) || [],
    })};
    function safeMermaidText(t, max) {
      var s = String(t == null ? "" : t).replace(/\\\\/g, "/").replace(/"/g, "'").replace(/[#|]/g, " ").replace(/[\\[\\]{}]/g, " ").replace(/\\n/g, " ").trim();
      if (s.length > max) s = s.slice(0, max - 1) + "…";
      return s || "—";
    }
    function buildMermaid() {
      if (!traceData || traceData.length === 0) return "flowchart LR\\n  z0[No trace data]";
      var nodeIds = {};
      var n = 0;
      function idFor(name) {
        var k = String(name || "?");
        if (!Object.prototype.hasOwnProperty.call(nodeIds, k)) nodeIds[k] = "t" + n++;
        return nodeIds[k];
      }
      var lines = ["flowchart LR"];
      traceData.forEach(function(e, idx) {
        var a = idFor(e.from);
        var b = idFor(e.to);
        var fromL = safeMermaidText(e.from, 22);
        var toL = safeMermaidText(e.to, 22);
        var ann = safeMermaidText(String(e.annotation || "impact") + " n" + (e.count != null ? e.count : ""), 26);
        lines.push("  " + a + '["' + fromL + '"] -->|' + ann + "|" + b + '["' + toL + '"]');
      });
      return lines.join("\\n");
    }
    function buildMindmap() {
      var d = mindmapData;
      var lines = ["flowchart TB"];
      var mm = 0;
      function nid() { return "mm" + mm++; }
      var root = nid();
      lines.push('  ' + root + '["' + safeMermaidText("Incident overview", 24) + '"]');
      var nSum = nid();
      lines.push('  ' + root + ' --> ' + nSum + '["' + safeMermaidText(d.summary, 44) + '"]');
      var nTrig = nid();
      lines.push('  ' + root + ' --> ' + nTrig + '["' + safeMermaidText(d.trigger, 44) + '"]');
      if (d.services && d.services.length) {
        var hub = nid();
        lines.push('  ' + root + ' --> ' + hub + '["Services"]');
        d.services.slice(0, 6).forEach(function(sv) {
          lines.push('  ' + hub + ' --> ' + nid() + '["' + safeMermaidText(sv, 32) + '"]');
        });
      }
      if (d.signals && d.signals.length) {
        var sh = nid();
        lines.push('  ' + root + ' --> ' + sh + '["Signals"]');
        d.signals.slice(0, 6).forEach(function(s) {
          lines.push('  ' + sh + ' --> ' + nid() + '["' + safeMermaidText(s.label + " " + (s.severity || ""), 36) + '"]');
        });
      }
      if (d.rootCauses && d.rootCauses.length) {
        var rh = nid();
        lines.push('  ' + root + ' --> ' + rh + '["Hypotheses"]');
        d.rootCauses.slice(0, 5).forEach(function(r) {
          lines.push('  ' + rh + ' --> ' + nid() + '["' + safeMermaidText(String(r), 40) + '"]');
        });
      }
      if (d.actions && d.actions.length) {
        var ah = nid();
        lines.push('  ' + root + ' --> ' + ah + '["Next actions"]');
        d.actions.slice(0, 5).forEach(function(act) {
          lines.push('  ' + ah + ' --> ' + nid() + '["' + safeMermaidText(String(act), 40) + '"]');
        });
      }
      return lines.join("\\n");
    }
    function renderTraceGraph() {
      var el = document.getElementById("trace-graph");
      if (!el) return;
      el.innerHTML = '<div class="empty-state">Rendering…</div>';
      if (typeof mermaid === "undefined") { el.innerHTML = '<div class="empty-state">Mermaid not loaded</div>'; return; }
      mermaid.initialize({ theme: "dark", startOnLoad: false });
      mermaid.render("trace-" + Date.now(), buildMermaid()).then(function(r) { el.innerHTML = r.svg; }).catch(function() { el.innerHTML = '<div class="empty-state">Trace graph could not be rendered</div>'; });
    }
    function renderMindmap() {
      var el = document.getElementById("mindmap-graph");
      if (!el) return;
      el.innerHTML = '<div class="empty-state">Rendering…</div>';
      if (typeof mermaid === "undefined") { el.innerHTML = '<div class="empty-state">Mermaid not loaded</div>'; return; }
      mermaid.initialize({ theme: "dark", startOnLoad: false });
      mermaid.render("mindmap-" + Date.now(), buildMindmap()).then(function(r) { el.innerHTML = r.svg; }).catch(function() { el.innerHTML = '<div class="empty-state">Mind map could not be rendered</div>'; });
    }
    document.querySelectorAll(".tab").forEach(function(btn) {
      btn.addEventListener("click", function() {
        document.querySelectorAll(".tab").forEach(function(t) { t.classList.remove("active"); });
        document.querySelectorAll(".panel").forEach(function(p) { p.classList.remove("active"); });
        btn.classList.add("active");
        document.getElementById("panel-" + btn.dataset.panel).classList.add("active");
        if (btn.dataset.panel === "trace-graph") renderTraceGraph();
        if (btn.dataset.panel === "mindmap") renderMindmap();
      });
    });
    (function reportPanel() {
      var shell = document.getElementById("report-print-root");
      var rendered = document.getElementById("report-rendered");
      var toolbar = document.getElementById("report-toolbar");
      var statusEl = document.getElementById("report-status");
      var copyBtn = document.getElementById("report-copy");
      var dlBtn = document.getElementById("report-dl-md");
      var printBtn = document.getElementById("report-print");
      var lastText = "";
      var lastKind = "report";
      function setStatus(msg, err) {
        if (!statusEl) return;
        statusEl.textContent = msg || "";
        statusEl.style.color = err ? "var(--danger)" : "var(--fg-muted)";
      }
      function setExportEnabled(on) {
        if (copyBtn) copyBtn.disabled = !on;
        if (dlBtn) dlBtn.disabled = !on;
        if (printBtn) printBtn.disabled = !on;
        if (toolbar) toolbar.style.display = on ? "flex" : "none";
        if (shell) shell.style.display = on ? "block" : "none";
      }
      document.querySelectorAll(".report-btn[data-report]").forEach(function(btn) {
        btn.addEventListener("click", function() {
          var kind = btn.getAttribute("data-report");
          setStatus("Generating engine RCA / STAR…");
          setExportEnabled(false);
          if (rendered) rendered.innerHTML = "";
          fetch("/api/reports/heuristic", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: kind })
          }).then(function(r) {
            if (!r.ok) return r.text().then(function(t) { throw new Error(t || "HTTP " + r.status); });
            return r.json();
          }).then(function(data) {
            lastText = data.markdown || "";
            lastKind = data.kind || "report";
            if (rendered) rendered.innerHTML = data.html || "";
            setExportEnabled(!!lastText);
            setStatus("Ready — " + (data.generatedAt || "") + ". Engine-only RCA / STAR below; use Copy / Download / PDF.");
          }).catch(function(e) {
            setStatus("Failed: " + (e && e.message ? e.message : String(e)), true);
          });
        });
      });
      if (copyBtn) {
        copyBtn.addEventListener("click", function() {
          if (!lastText || !navigator.clipboard) { setStatus("Clipboard unavailable.", true); return; }
          navigator.clipboard.writeText(lastText).then(function() { setStatus("Markdown copied."); }).catch(function() { setStatus("Copy failed.", true); });
        });
      }
      if (dlBtn) {
        dlBtn.addEventListener("click", function() {
          if (!lastText) return;
          var blob = new Blob([lastText], { type: "text/markdown;charset=utf-8" });
          var a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "solidx-" + lastKind + "-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".md";
          a.click();
          URL.revokeObjectURL(a.href);
          setStatus("Download started.");
        });
      }
      if (printBtn) {
        printBtn.addEventListener("click", function() {
          if (!lastText) return;
          setStatus("Print dialog: choose “Save as PDF” if you want a PDF file.");
          window.print();
        });
      }
    })();
    (function pollEnrich() {
      var needPoll = ${JSON.stringify(Boolean(ai.enrichmentPending || ai.enrichmentLoading))};
      if (!needPoll) return;
      var timer = setInterval(function() {
        fetch("/api/analysis", { cache: "no-store" })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            var a = d.ai;
            if (a && !a.enrichmentLoading && !a.enrichmentPending) {
              clearInterval(timer);
              location.reload();
            }
          })
          .catch(function() {});
      }, 1200);
    })();
    (function signalEvidenceModal() {
      var modal = document.getElementById("signal-evidence-modal");
      var titleEl = document.getElementById("signal-evidence-title");
      var hintEl = document.getElementById("signal-evidence-hint");
      var bodyEl = document.getElementById("signal-evidence-body");
      if (!modal || !titleEl || !hintEl || !bodyEl) return;
      function closeModal() {
        modal.classList.remove("open");
        document.body.style.overflow = "";
      }
      function openModal(bundle) {
        if (!bundle) return;
        titleEl.textContent = bundle.label || "Signal";
        if (bundle.hint) {
          hintEl.textContent = bundle.hint;
          hintEl.classList.add("show");
        } else {
          hintEl.textContent = "";
          hintEl.classList.remove("show");
        }
        bodyEl.innerHTML = "";
        if (!bundle.lines || !bundle.lines.length) {
          var p = document.createElement("p");
          p.className = "ai-status-note";
          p.style.textAlign = "left";
          p.textContent = bundle.hint || "No log lines to show for this signal.";
          bodyEl.appendChild(p);
        } else {
          bundle.lines.forEach(function(line) {
            var wrap = document.createElement("div");
            wrap.className = "signal-ev-line";
            var meta = document.createElement("div");
            meta.className = "signal-ev-meta";
            var parts = ["#" + (line.eventIndex + 1), line.timestamp, line.service, line.severity];
            if (line.lineNumber != null) parts.push("line " + line.lineNumber);
            if (line.sourceName) parts.push(line.sourceName);
            meta.textContent = parts.join(" · ");
            var msg = document.createElement("div");
            msg.textContent = line.message || "";
            wrap.appendChild(meta);
            wrap.appendChild(msg);
            if (line.rawLine) {
              var raw = document.createElement("div");
              raw.className = "signal-ev-raw";
              raw.textContent = line.rawLine;
              wrap.appendChild(raw);
            }
            bodyEl.appendChild(wrap);
          });
        }
        modal.classList.add("open");
        document.body.style.overflow = "hidden";
      }
      function openFromIndex(idx) {
        var n = parseInt(idx, 10);
        if (Number.isNaN(n) || !signalEvidence[n]) return;
        openModal(signalEvidence[n]);
      }
      document.addEventListener("click", function(e) {
        var t = e.target;
        if (t && t.closest && t.closest("[data-close-signal-modal]")) {
          closeModal();
          return;
        }
        var card = t && t.closest ? t.closest("[data-signal-index]") : null;
        if (!card) return;
        openFromIndex(card.getAttribute("data-signal-index"));
      });
      document.addEventListener("keydown", function(e) {
        if (e.key === "Escape" && modal.classList.contains("open")) {
          e.preventDefault();
          closeModal();
          return;
        }
        if ((e.key === "Enter" || e.key === " ") && e.target && e.target.closest) {
          var card = e.target.closest("[data-signal-index]");
          if (card && modal && !modal.classList.contains("open")) {
            e.preventDefault();
            openFromIndex(card.getAttribute("data-signal-index"));
          }
        }
      });
    })();
  </script>
</body>
</html>`;
}

export interface WebServerOptions {
  port?: number;
  openBrowser?: boolean;
  /** Fire-and-forget enrich after the server is listening (mutates \`result\` in place). */
  backgroundEnrich?: () => Promise<void>;
}

export function serveAnalysis(result: AnalysisResult, opts: WebServerOptions = {}): Promise<{ port: number; url: string }> {
  const port = opts.port ?? DEFAULT_PORT;
  const openBrowser = opts.openBrowser ?? true;

  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const path = (req.url || "").split("?")[0];
      if (path === "/" || path === "/index.html" || path === "") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(buildHtml(result));
        return;
      }
      if (path === "/api/analysis" || path === "/api/data") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result, null, 2));
        return;
      }
      if (path === "/api/reports/heuristic" && req.method === "POST") {
        void readJsonBody(req)
          .then((body) => {
            const kind = body.kind;
            if (kind !== "rca" && kind !== "interview") {
              res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ error: 'body.kind must be "rca" or "interview"' }));
              return;
            }
            const snap = applyHeuristicReport(result, kind);
            const html = markdownToSafeHtml(snap.markdown);
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ kind: snap.kind, markdown: snap.markdown, html, generatedAt: snap.generatedAt }));
          })
          .catch(() => {
            res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: "Invalid JSON body" }));
          });
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    });

    server.listen(port, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${port}`;
      if (opts.backgroundEnrich) {
        void opts.backgroundEnrich();
      }
      if (openBrowser) {
        import("child_process").then(({ exec }) => {
          const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
          exec(`${cmd} ${url}`, () => {});
        }).catch(() => {});
      }
      resolve({ port, url });
    });

    server.on("error", reject);
  });
}
