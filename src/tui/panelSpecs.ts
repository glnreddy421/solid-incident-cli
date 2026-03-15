import type { AnalysisResult, TuiPanelId } from "../contracts/index.js";

export interface PanelSpec {
  id: TuiPanelId;
  title: string;
  description: string;
  main: (result: AnalysisResult, filter: string, search: string) => string[];
  side: (result: AnalysisResult, filter: string, search: string) => string[];
}

function applyTextFilter(lines: string[], filter: string, search: string): string[] {
  const query = (search || filter).trim().toLowerCase();
  if (!query) return lines;
  return lines.filter((line) => line.toLowerCase().includes(query));
}

function topSignals(result: AnalysisResult): string[] {
  return [...result.signals]
    .sort((a, b) => (b.score ?? b.count ?? 0) - (a.score ?? a.count ?? 0))
    .slice(0, 5)
    .map((signal, idx) => `${idx + 1}. ${signal.label} (${signal.severity}${signal.count ? `, ${signal.count}x` : ""})`);
}

export const PANEL_SPECS: Record<TuiPanelId, PanelSpec> = {
  summary: {
    id: "summary",
    title: "Incident Overview",
    description: "Summary-first context for rapid incident understanding.",
    main: (result) => [
      "What happened",
      result.summary.incidentSummary || "No incident summary available yet.",
      "",
      "Trigger candidate",
      result.summary.triggerEvent || "No trigger identified yet.",
      "",
      "Next best actions",
      ...(result.ai.recommendedChecks.length
        ? result.ai.recommendedChecks.slice(0, 4).map((step, idx) => `${idx + 1}. ${step}`)
        : ["1. Inspect timeline highlights", "2. Check strongest signals", "3. Review evidence details"]),
      "",
      "Strongest signals",
      ...topSignals(result),
    ],
    side: (result) => [
      "Incident metadata",
      `Confidence: ${result.summary.confidence}%`,
      `Mode: ${result.mode}`,
      `Window: ${result.summary.incidentWindow.start} -> ${result.summary.incidentWindow.end}`,
      `Services: ${result.summary.affectedServices.join(", ") || "unknown"}`,
      "",
      "Diagnostics",
      `Warnings: ${result.diagnostics.warnings.length}`,
      `Errors: ${result.diagnostics.errors.length}`,
      `AI: ${result.ai.available ? "available" : "unavailable"}`,
    ],
  },
  timeline: {
    id: "timeline",
    title: "Timeline",
    description: "Ordered event progression with trigger/anomaly emphasis.",
    main: (result, filter, search) => {
      const lines = result.timeline.map((event) => {
        const mark = event.isTrigger ? "TRIGGER" : event.anomaly ? "ANOM" : "    ";
        return `${mark} ${event.timestamp} [${event.severity}] ${event.service} - ${event.message}`;
      });
      const filtered = applyTextFilter(lines, filter, search);
      return filtered.length ? filtered.slice(0, 42) : ["No timeline events match current search/filter."];
    },
    side: (result) => {
      const anomalies = result.timeline.filter((entry) => entry.anomaly).length;
      const triggers = result.timeline.filter((entry) => entry.isTrigger).length;
      return [
        "Timeline context",
        `Events: ${result.timeline.length}`,
        `Anomalies: ${anomalies}`,
        `Triggers: ${triggers}`,
        "",
        "Quick actions",
        "t - jump to trigger",
        "s - jump to strongest signal",
        "x - clear focus",
      ];
    },
  },
  flow: {
    id: "flow",
    title: "Propagation Flow",
    description: "Likely failure chain and dependency propagation.",
    main: (result) => {
      if (!result.flow.length) return ["No service propagation flow inferred yet."];
      return result.flow
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 30)
        .map((edge) => `${edge.from.padEnd(20)} -> ${edge.to.padEnd(20)} conf ${Math.round(edge.confidence * 100)}% (${edge.count})`);
    },
    side: (result) => {
      const best = [...result.flow].sort((a, b) => b.confidence - a.confidence)[0];
      return [
        "Best flow candidate",
        best ? `${best.from} -> ${best.to}` : "No candidate",
        best ? `Confidence: ${Math.round(best.confidence * 100)}%` : "Confidence: n/a",
        "",
        "Interpretation",
        "Use this to verify where failures propagate and which downstream systems were impacted.",
      ];
    },
  },
  signals: {
    id: "signals",
    title: "Signals",
    description: "Heuristic and anomaly signals ranked by evidence.",
    main: (result, filter, search) => {
      const lines = [...result.signals]
        .sort((a, b) => (b.score ?? b.count ?? 0) - (a.score ?? a.count ?? 0))
        .map((signal) => `[${signal.severity}] ${signal.label} | score ${signal.score ?? signal.count ?? 1}${signal.description ? ` | ${signal.description}` : ""}`);
      const filtered = applyTextFilter(lines, filter, search);
      return filtered.length ? filtered : ["No signals match current search/filter."];
    },
    side: (result) => [
      "Signal context",
      `Total signals: ${result.signals.length}`,
      `Critical/Error: ${result.signals.filter((s) => s.severity === "critical" || s.severity === "error").length}`,
      "",
      "Tip",
      "Press s to jump to the strongest signal and pivot to evidence.",
    ],
  },
  evidence: {
    id: "evidence",
    title: "Evidence",
    description: "Filterable normalized event evidence for debugging depth.",
    main: (result, filter, search) => {
      const lines = result.rawEvents.map(
        (event) => `${String(event.lineNumber ?? "-").padStart(4)} ${event.timestamp} ${event.service} [${event.severity}] ${event.message}`
      );
      const filtered = applyTextFilter(lines, filter, search);
      return filtered.length ? filtered.slice(0, 42) : ["No evidence events match current search/filter."];
    },
    side: (_result, filter, search) => [
      "Filters",
      `Search: ${search || "-"}`,
      `Filter: ${filter || "-"}`,
      "",
      "Actions",
      "/ - search",
      "f - filter",
      "x - clear filters",
    ],
  },
  "ai-analysis": {
    id: "ai-analysis",
    title: "AI Analysis",
    description: "Structured reasoning and follow-up questions.",
    main: (result) => {
      if (!result.ai.available) {
        return [
          "AI unavailable",
          result.ai.warning || "No AI response yet.",
          "",
          "You can still investigate using timeline, signals, flow, and evidence.",
        ];
      }
      return [
        "AI Summary",
        result.ai.summary || "No summary available.",
        "",
        "Root cause candidates",
        ...(result.ai.rootCauseCandidates.length ? result.ai.rootCauseCandidates.map((c) => `- ${c}`) : ["- none"]),
        "",
        "Follow-up questions",
        ...(result.ai.followUpQuestions.length ? result.ai.followUpQuestions.map((q) => `- ${q}`) : ["- none"]),
      ];
    },
    side: (result) => [
      "AI actions",
      "g - refresh reasoning",
      "u - manual AI update (live mode)",
      "",
      "Recommended checks",
      ...(result.ai.recommendedChecks.length ? result.ai.recommendedChecks.slice(0, 6).map((c) => `- ${c}`) : ["- none"]),
    ],
  },
  reports: {
    id: "reports",
    title: "Reports & Actions",
    description: "Generate and export incident outputs.",
    main: (result) => [
      "Generate",
      "r - Incident report",
      "c - RCA report",
      "i - Interview STAR story",
      "",
      "Export",
      "e - export (JSON/Markdown/HTML)",
      "w - save snapshot/session",
      "",
      "Status",
      `Generated reports: ${Object.keys(result.ai.reports).length}`,
      `Session mode: ${result.mode}`,
    ],
    side: (result) => [
      "Report inventory",
      ...(Object.values(result.ai.reports).length
        ? Object.values(result.ai.reports).map((r) => `- ${r.title} @ ${r.generatedAt}`)
        : ["No reports generated yet."]),
    ],
  },
  diagnostics: {
    id: "diagnostics",
    title: "Diagnostics",
    description: "Schema and transport diagnostics for power users.",
    main: (result) => {
      const schemaLines = JSON.stringify(
        {
          schemaVersion: result.schema.schemaVersion,
          generatedAt: result.schema.generatedAt,
          timeline: result.schema.timeline.length,
          flow: result.schema.flow.length,
          signals: result.schema.signals.length,
        },
        null,
        2
      ).split("\n");
      return [
        "Schema snapshot",
        ...schemaLines,
        "",
        "Engine warnings",
        ...(result.diagnostics.warnings.length ? result.diagnostics.warnings.map((w) => `- ${w}`) : ["- none"]),
      ];
    },
    side: (result) => [
      "Transport",
      `Backend reachable: ${result.diagnostics.transport.backendReachable ? "yes" : "no"}`,
      `Latency: ${result.diagnostics.transport.latencyMs ?? "n/a"}`,
      `Status code: ${result.diagnostics.transport.statusCode ?? "n/a"}`,
      "",
      "Debug",
      "Verbose mode shows typed error details.",
    ],
  },
};

