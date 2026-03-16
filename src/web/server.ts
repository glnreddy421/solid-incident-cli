import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { AnalysisResult } from "../contracts/index.js";

const DEFAULT_PORT = 3456;

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildHtml(result: AnalysisResult): string {
  const esc = escapeHtml;
  const s = result.summary;
  const a = result.assessment;
  const ai = result.ai;
  const topSignals = [...result.signals]
    .sort((a, b) => (b.score ?? b.count ?? 0) - (a.score ?? a.count ?? 0))
    .slice(0, 8);
  const traceEdges =
    result.traceGraph?.edges?.length > 0
      ? result.traceGraph.edges
      : result.flow.map((e) => ({ from: e.from, to: e.to, annotation: "impact", count: e.count, confidence: e.confidence }));

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
    .stat-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 0.75rem 1rem; min-width: 140px; }
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
    .signal-pill { display: inline-block; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 999px; padding: 0.35rem 0.75rem; font-size: 0.8rem; margin: 0.25rem 0.25rem 0 0; }
    .signal-pill.critical { border-color: var(--danger); color: var(--danger); }
    .signal-pill.error { border-color: var(--danger); color: var(--danger); }
    .signal-pill.warning { border-color: var(--warn); color: var(--warn); }
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
    .trace-graph-container { min-height: 400px; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.5rem; }
    .trace-graph-container { display: flex; align-items: center; justify-content: center; }
    .trace-graph-container svg { max-width: 100%; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
</head>
<body>
  <div class="app">
    <header class="header">
      <div class="logo">SOLIDX</div>
      <div class="stats">
        <div class="stat-card confidence"><div class="stat-label">Confidence</div><div class="stat-value">${s.confidence}%</div></div>
        <div class="stat-card"><div class="stat-label">Verdict</div><div class="stat-value">${esc(a.verdict)}</div></div>
        <div class="stat-card"><div class="stat-label">Health</div><div class="stat-value">${a.healthScore}/100</div></div>
        <div class="stat-card"><div class="stat-label">Events</div><div class="stat-value">${result.timeline.length}</div></div>
        <div class="stat-card"><div class="stat-label">Services</div><div class="stat-value">${esc(s.affectedServices.join(", ") || "—")}</div></div>
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
      <button class="tab" data-panel="ai-analysis">AI Analysis</button>
      <button class="tab" data-panel="reports">Reports</button>
      <button class="tab" data-panel="diagnostics">Diagnostics</button>
    </nav>

    <div id="panel-summary" class="panel active">
      <div class="card"><div class="card-title">Incident verdict</div><div class="card-body"><div><strong>${esc(a.verdict)}</strong></div><div>Severity: ${esc(a.severity)}</div><div>Reason: ${esc(a.verdictReason)}</div></div></div>
      <div class="card"><div class="card-title">What happened</div><div class="card-body summary-text">${esc(a.summaryNarrative || s.incidentSummary || "No incident summary available.")}</div></div>
      <div class="card"><div class="card-title">Trigger candidate</div><div class="trigger-box">Service: ${esc(a.triggerService)}<br>Event: ${esc(a.triggerEvent)}<br>PID: ${esc(a.triggerPid ?? "-")}<br>Host: ${esc(a.triggerHost ?? "-")}<br>Timestamp: ${esc(a.triggerTimestamp)}<br>Classification: ${esc(a.triggerClassification)}<br>Impact: ${esc(a.triggerImpact)}</div></div>
      <div class="card"><div class="card-title">Event distribution</div><div class="card-body">info ${a.eventDistribution.info} | warn ${a.eventDistribution.warn} | error ${a.eventDistribution.error} | anomaly ${a.eventDistribution.anomaly}</div></div>
      <div class="card"><div class="card-title">System health summary</div><ul class="action-list">${a.systemHealthSummary.slice(0, 5).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      <div class="card"><div class="card-title">Next best actions</div><ul class="action-list">${a.recommendedActions.slice(0, 5).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      <div class="card"><div class="card-title">Strongest signals</div>${topSignals.map((sig) => `<span class="signal-pill ${sig.severity}">${esc(sig.label)} (${sig.severity}${sig.count ? `, ${sig.count}x` : ""})</span>`).join("")}</div>
      <div class="card"><div class="card-title">Root cause candidates</div><ul class="action-list">${a.rootCauseCandidates.slice(0, 4).map((r) => `<li>${esc(r.id)} (${Math.round(r.confidence * 100)}%) - ${esc(r.evidence)}</li>`).join("")}</ul></div>
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
      <div class="card"><div class="card-title">Signals</div>${result.signals.length ? result.signals.map((sig) => `<span class="signal-pill ${sig.severity}">${esc(sig.label)} — ${sig.severity}${sig.count ? ` (${sig.count}x)` : ""}${sig.description ? `: ${esc(sig.description)}` : ""}</span>`).join("") : '<div class="empty-state">No signals detected</div>'}</div></div>
    </div>

    <div id="panel-evidence" class="panel">
      <div class="card"><div class="card-title">Evidence</div><pre>${result.rawEvents.slice(0, 30).map((e, i) => `${i + 1}. ${e.host ? `[${e.host}] ` : ""}${e.service} [${e.severity}] ${e.timestamp}: ${e.message}`).join("\n")}</pre></div>
    </div>

    <div id="panel-ai-analysis" class="panel">
      <div class="card"><div class="card-title">AI Analysis</div><div class="card-body">${ai.available ? `<p class="summary-text">${esc((ai.summary ?? "No AI summary.").replace(/\n/g, "<br>"))}</p>` : `<p class="empty-state">${esc(ai.warning ?? "AI unavailable.")}</p>`}</div></div>
      ${ai.rootCauseCandidates?.length ? `<div class="card"><div class="card-title">Root cause candidates</div><ul class="action-list">${ai.rootCauseCandidates.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>` : ""}
      ${ai.followUpQuestions?.length ? `<div class="card"><div class="card-title">Follow-up questions</div><ul class="action-list">${ai.followUpQuestions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul></div>` : ""}
    </div>

    <div id="panel-reports" class="panel">
      <div class="card">${Object.values(ai.reports || {}).filter(Boolean).length ? Object.entries(ai.reports || {}).filter(([, r]) => r).map(([, r]) => `<div class="card-title">${esc(r!.title)}</div><pre>${esc(r!.body)}</pre>`).join("") : '<div class="card-title">Reports</div><div class="empty-state">No reports generated. Use --report, --rca, or --interview-story to generate.</div>'}</div>
    </div>

    <div id="panel-diagnostics" class="panel">
      <div class="card"><div class="card-title">Diagnostics</div><div class="stats" style="margin-bottom:1rem"><div class="stat-card"><div class="stat-label">Warnings</div><div class="stat-value">${result.diagnostics.warnings.length}</div></div><div class="stat-card"><div class="stat-label">Errors</div><div class="stat-value">${result.diagnostics.errors.length}</div></div></div>${result.diagnostics.warnings.length ? `<ul class="action-list">${result.diagnostics.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}${result.diagnostics.errors.length ? `<ul class="action-list">${result.diagnostics.errors.map((e) => `<li style="color:var(--danger)">${esc(e)}</li>`).join("")}</ul>` : ""}</div>
    </div>
  </div>

  <script>
    const traceData = ${JSON.stringify(traceEdges)};
    const mindmapData = ${JSON.stringify({
      summary: s.incidentSummary || "No summary",
      trigger: s.triggerEvent,
      services: s.affectedServices,
      signals: result.signals.slice(0, 8).map((x) => ({ label: x.label, severity: x.severity })),
      rootCauses: ai.rootCauseCandidates || [],
      actions: ai.recommendedChecks?.slice(0, 5) || [],
    })};
    function mermaidId(s) { return "N" + String(s).replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").slice(0, 25) || "X"; }
    function safeLabel(t) { return String(t || "").replace(/[\\[\\]{}():]/g, " ").slice(0, 30).trim() || "—"; }
    function buildMermaid() {
      if (!traceData || traceData.length === 0) return "flowchart LR\\n  A[No trace data]";
      var lines = ["flowchart LR"];
      traceData.forEach(function(e) {
        var a = mermaidId(e.from), b = mermaidId(e.to);
        var fromLabel = (e.from || "").length > 18 ? (e.from || "").slice(0, 15) + "…" : (e.from || "?");
        var toLabel = (e.to || "").length > 18 ? (e.to || "").slice(0, 15) + "…" : (e.to || "?");
        fromLabel = fromLabel.replace(/["\\[\\]]/g, "'");
        toLabel = toLabel.replace(/["\\[\\]]/g, "'");
        var ann = (e.annotation || "impact").replace(/["\\[\\]|]/g, " ").slice(0, 20);
        var score = (e.heuristicScore != null ? " h" + Math.round(e.heuristicScore * 100) + "% " : " ") + e.count;
        lines.push("  " + a + "[" + fromLabel + "] -->|" + ann + score + "|" + b + "[" + toLabel + "]");
      });
      return lines.join("\\n");
    }
    function buildMindmap() {
      var d = mindmapData, lines = ["mindmap"];
      lines.push("  root((Incident))");
      lines.push("    Summary");
      lines.push("      " + safeLabel(d.summary));
      lines.push("    Trigger");
      lines.push("      " + safeLabel(d.trigger));
      if (d.services && d.services.length) {
        lines.push("    Services");
        d.services.slice(0, 6).forEach(function(s) { lines.push("      " + safeLabel(s)); });
      }
      if (d.signals && d.signals.length) {
        lines.push("    Signals");
        d.signals.forEach(function(s) { lines.push("      " + safeLabel(s.label) + " " + (s.severity || "")); });
      }
      if (d.rootCauses && d.rootCauses.length) {
        lines.push("    Root causes");
        d.rootCauses.slice(0, 4).forEach(function(r) { lines.push("      " + safeLabel(r)); });
      }
      if (d.actions && d.actions.length) {
        lines.push("    Next actions");
        d.actions.forEach(function(a) { lines.push("      " + safeLabel(a)); });
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
  </script>
</body>
</html>`;
}

export interface WebServerOptions {
  port?: number;
  openBrowser?: boolean;
}

export function serveAnalysis(result: AnalysisResult, opts: WebServerOptions = {}): Promise<{ port: number; url: string }> {
  const port = opts.port ?? DEFAULT_PORT;
  const openBrowser = opts.openBrowser ?? true;

  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === "/" || req.url === "/index.html" || req.url === "") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(buildHtml(result));
        return;
      }
      if (req.url === "/api/analysis" || req.url === "/api/data") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result, null, 2));
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    });

    server.listen(port, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${port}`;
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
