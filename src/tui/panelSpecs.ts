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

function formatDuration(start: string, end: string): string {
  if (!start || !end || start === "unknown" || end === "unknown") return "n/a";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "n/a";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function topSignals(result: AnalysisResult): string[] {
  return [...result.signals]
    .sort((a, b) => (b.score ?? b.count ?? 0) - (a.score ?? a.count ?? 0))
    .slice(0, 5)
    .map((signal, idx) => {
      const scoreTag = formatSignalScoreTag(signal);
      return `${idx + 1}. ${signal.label} (${signal.severity}${signal.count ? `, ${signal.count}x` : ""}${scoreTag})`;
    });
}

function fmtPct(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return `${Math.round(value * 100)}%`;
}

function formatSignalScoreTag(s: { mlScore?: number; scoreSource?: string }): string {
  if (s.mlScore == null) return "";
  const tag = s.scoreSource === "tfidf" ? "tfidf" : "ml";
  return ` ${tag}:${Math.round(s.mlScore * 100)}`;
}

function collapseTimelineRuns(lines: string[]): string[] {
  if (!lines.length) return [];
  const out: string[] = [];
  let current = lines[0];
  let count = 1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === current) {
      count += 1;
      continue;
    }
    out.push(count > 1 ? `${current}  (x${count})` : current);
    current = lines[i];
    count = 1;
  }
  out.push(count > 1 ? `${current}  (x${count})` : current);
  return out;
}

export const PANEL_SPECS: Record<TuiPanelId, PanelSpec> = {
  summary: {
    id: "summary",
    title: "Incident Overview",
    description: "Summary-first context for rapid incident understanding.",
    main: (result) => {
      const a = result.assessment;
      const ai = result.ai;
      const triggerMessage = a.triggerEvent ? a.triggerEvent.slice(0, 72) : "No trigger identified";
      const strongestSignals = a.strongestSignals.length
        ? a.strongestSignals.map((s, i) => `${i + 1}. ${s}`)
        : ["Strongest signals: none of incident significance"];

      const useAi = ai.available;
      const engineFallback = a.summaryNarrative || result.summary.incidentSummary;
      const narrative = useAi ? (ai.summary ?? engineFallback) : (engineFallback || "No incident summary available yet.");
      const explanation = useAi ? undefined : a.humanExplanation;
      const causes = useAi ? ai.rootCauseCandidates : (a.suggestedCauses ?? []);
      const fixes = useAi ? ai.recommendedChecks : (a.suggestedFixes ?? []);

      return [
        "Incident Verdict",
        a.verdict,
        `Severity: ${a.severity}`,
        `Health score: ${a.healthScore} / 100`,
        `Confidence: ${result.summary.confidence}%`,
        `Reason: ${a.verdictReason}`,
        "",
        "What happened",
        narrative,
        "",
        "Trigger candidate",
        `Service: ${a.triggerService}`,
        `Event: ${triggerMessage}`,
        `PID: ${a.triggerPid ?? "-"}`,
        `Host: ${a.triggerHost ?? "-"}`,
        `Timestamp: ${a.triggerTimestamp}`,
        `Classification: ${a.triggerClassification}`,
        `Impact: ${a.triggerImpact}`,
        "",
        "Engine analysis",
        `Services analyzed: ${a.serviceCount}`,
        `Primary service: ${a.primaryService}`,
        `Trace edges: ${result.traceGraph.edges.length}`,
        `ML model: ${result.mlEnrichment?.available ? result.mlEnrichment.modelType : "none"}`,
        "",
        "Event distribution",
        `info: ${a.eventDistribution.info} | warn: ${a.eventDistribution.warn} | error: ${a.eventDistribution.error} | anomaly: ${a.eventDistribution.anomaly}`,
        "",
        "System health summary",
        ...(a.systemHealthSummary.length ? a.systemHealthSummary.slice(0, 4) : ["No health summary available."]),
        "",
        "Strongest signals",
        ...strongestSignals,
        "",
        ...(useAi
          ? []
          : [
              "Root cause candidates",
              ...(a.rootCauseCandidates.length
                ? a.rootCauseCandidates.slice(0, 3).map((r, idx) => `${idx + 1}. ${r.id ?? r.evidence} (confidence ${Math.round(r.confidence * 100)}%, evidence: ${r.evidence})`)
                : ["No dominant root cause pattern identified."]),
              "",
              "Next best actions",
              ...(a.recommendedActions.length
                ? a.recommendedActions.slice(0, 4).map((step, idx) => `${idx + 1}. ${step}`)
                : ["1. No recommendation available."]),
              "",
            ]),
        ...(explanation ? ["Explanation", explanation, ""] : []),
        ...(causes.length ? ["Suggested causes", ...causes.map((c) => `  • ${c}`), ""] : []),
        ...(fixes.length ? ["Suggested fixes", ...fixes.map((f) => `  • ${f}`), ""] : []),
      ];
    },
    side: (result) => [
      "Incident metadata",
      `Verdict: ${result.assessment.verdict}`,
      `Severity: ${result.assessment.severity}`,
      `Health: ${result.assessment.healthScore}/100`,
      `Confidence: ${result.summary.confidence}%`,
      `Mode: ${result.mode}`,
      `Window: ${result.summary.incidentWindow.start} -> ${result.summary.incidentWindow.end}`,
      `Duration: ${formatDuration(result.summary.incidentWindow.start, result.summary.incidentWindow.end)}`,
      `Services analyzed: ${result.assessment.serviceCount}`,
      `Primary service: ${result.assessment.primaryService}`,
      "",
      "Diagnostics",
      `Warnings: ${result.diagnostics.warnings.length}`,
      `Errors: ${result.diagnostics.errors.length}`,
      `Anomalies: ${result.assessment.anomalyCount}`,
      `AI: ${result.ai.available ? "available" : "unavailable"}`,
    ],
  },
  timeline: {
    id: "timeline",
    title: "Timeline",
    description: "Ordered event progression with trigger/anomaly emphasis.",
    main: (result, filter, search) => {
      const sortedRaw = [...result.timeline].sort((a, b) => {
        const aKnown = a.timestamp !== "unknown";
        const bKnown = b.timestamp !== "unknown";
        if (aKnown && bKnown) {
          const diff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
          if (diff !== 0) return diff;
          return (a.lineNumber ?? Number.MAX_SAFE_INTEGER) - (b.lineNumber ?? Number.MAX_SAFE_INTEGER);
        }
        if (aKnown && !bKnown) return -1;
        if (!aKnown && bKnown) return 1;
        return (a.lineNumber ?? Number.MAX_SAFE_INTEGER) - (b.lineNumber ?? Number.MAX_SAFE_INTEGER);
      });
      const rawLines = sortedRaw.map((event, idx) => {
        const seq = String(idx + 1).padStart(3, "0");
        const ts = event.timestamp === "unknown" ? `seq#${seq}` : event.timestamp;
        const host = event.host ? ` [${event.host}]` : "";
        const flags: string[] = [];
        if (event.isTrigger) flags.push("trigger");
        if (event.anomaly) flags.push("anomaly");
        const marker = flags.length ? `, ${flags.join(",")}` : "";
        return `${ts}${host} [${event.severity}${marker}] ${event.service} ${event.message}`;
      });
      const collapsedRaw = collapseTimelineRuns(rawLines);
      const summaryLines = result.assessment.reconstructedTimeline.length
        ? result.assessment.reconstructedTimeline
        : ["Timeline summary unavailable."];
      const lines = [
        "Raw chronological events",
        ...collapsedRaw,
        "",
        "Timeline summary",
        ...summaryLines.slice(0, 8),
      ];
      const filtered = applyTextFilter(lines, filter, search);
      if (!filtered.length) return ["No timeline events match current search/filter."];
      return filtered;
    },
    side: (result) => {
      const anomalies = result.timeline.filter((entry) => entry.anomaly).length;
      const triggers = result.timeline.filter((entry) => entry.isTrigger).length;
      const reconstructed = result.assessment.reconstructedTimeline ?? [];
      const timelineSummary = reconstructed.find((line) => line.startsWith("Timeline summary:")) ?? "Timeline summary: unavailable";
      const sourceSummary = reconstructed.find((line) => line.startsWith("Merged input sources:")) ?? "Merged input sources: 1";
      return [
        "Timeline context",
        "Chronology summary",
        timelineSummary,
        sourceSummary,
        "",
        `View: rolling tail (latest events)`,
        `Events: ${result.timeline.length}`,
        `Window start: ${result.analysisWindow?.start ?? result.summary.incidentWindow.start}`,
        `Window end: ${result.analysisWindow?.end ?? result.summary.incidentWindow.end}`,
        `Duration: ${result.analysisWindow?.durationSeconds ?? 0}s`,
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
  "trace-graph": {
    id: "trace-graph",
    title: "Trace Graph",
    description: "Inferred failure propagation: who triggered → who reacted → what happened.",
    main: (result, _filter, _search) => {
      const tg = result.traceGraph;
      const lines: string[] = ["Trace Flow", "─".repeat(28), ""];

      if (tg.edges.length > 0) {
        for (let i = 0; i < tg.edges.length && i < 12; i++) {
          const e = tg.edges[i];
          const prevTo = i > 0 ? tg.edges[i - 1].to : null;
          const h = e.heuristicScore != null ? Math.round(e.heuristicScore * 100) : null;
          const m = e.mlScore != null ? Math.round(e.mlScore * 100) : null;
          const score = h != null || m != null ? ` (h:${h ?? "-"}${m != null ? ` ml:${m}` : ""})` : "";
          if (prevTo !== e.from) lines.push(e.from);
          lines.push("  │");
          lines.push(`  │ ${e.annotation}${score}`);
          if (e.keySignals?.length) lines.push(`  │ key: ${e.keySignals.slice(0, 2).join(", ")}`);
          lines.push("  ▼");
          lines.push(e.to);
          if (i < tg.edges.length - 1) lines.push("");
        }
        lines.push("", "─".repeat(28));
        const chain = tg.edges.slice(0, 5).map((e) => `${e.from} → ${e.to}`).join(" → ");
        if (chain) lines.push("Chain: " + chain);
        if (tg.inferredFromSequence) lines.push("", "(inferred from event sequence)");
        if (result.assessment.propagationChain.length) {
          lines.push("", "Propagation reasoning");
          lines.push(...result.assessment.propagationChain.slice(0, 5).map((p) => `- ${p}`));
        }
      } else if (tg.nodes.length > 0) {
        lines.push("Services involved", "");
        for (const node of tg.nodes.slice(0, 8)) {
          const sigs = tg.nodeSignals?.[node] ?? result.signals.filter((s) => s.service === node).map((s) => s.label);
          lines.push(`• ${node}`);
          if (sigs.length) lines.push(`  Key signs: ${sigs.slice(0, 3).join("; ")}`);
        }
        lines.push("", "─".repeat(28));
        lines.push("Only one service detected. Trace graphs require multiple services.");
        lines.push("No multi-service transitions detected.");
        lines.push("", "Tip: Use --web for interactive graph.");
      } else {
        lines.push("No trace flow inferred.", "");
        lines.push("Trace graph = services + events + dependencies + time.");
        lines.push("Engine derives propagation from log patterns and timing.");
        lines.push("", "Ensure logs include service names (JSON, K8s format).");
        lines.push("Tip: Use --web for interactive Mermaid graph.");
      }
      return lines;
    },
    side: (result) => {
      const tg = result.traceGraph;
      const trigger = result.assessment;
      const topSigs = [...result.signals].sort((a, b) => (b.score ?? b.count ?? 0) - (a.score ?? a.count ?? 0)).slice(0, 3);
      return [
        "Trace context",
        `Nodes: ${tg.nodes.length}`,
        `Edges: ${tg.edges.length}`,
        tg.inferredFromSequence ? "Mode: inferred sequence" : "",
        "",
        "Trigger candidate",
        `${trigger.triggerService}: ${trigger.triggerEvent.slice(0, 35)}${trigger.triggerEvent.length > 35 ? "…" : ""}`,
        `Classification: ${trigger.triggerClassification}`,
        `Impact: ${trigger.triggerImpact}`,
        "",
        "Key signals",
        ...topSigs.map((s) => `• ${s.label}${formatSignalScoreTag(s)}`),
        result.mlEnrichment?.available ? "ML: kmeans anomaly" : "",
        "",
        "Web UI",
        "solidx analyze <file> --web",
      ];
    },
  },
  mindmap: {
    id: "mindmap",
    title: "Mind Map",
    description: "Incident structure as hierarchy (same as web UI).",
    main: (result, _filter, _search) => {
      const s = result.assessment;
      const ai = result.ai;
      const topSignals = [...result.signals].sort((a, b) => (b.score ?? b.count ?? 0) - (a.score ?? a.count ?? 0)).slice(0, 5);
      return [
        "Incident",
        "  Summary",
        `    ${(s.summaryNarrative || "No summary").slice(0, 60)}${(s.summaryNarrative || "").length > 60 ? "…" : ""}`,
        "  Trigger",
        `    ${s.triggerService} -> ${s.triggerEvent}`,
        "  Services",
        ...(result.summary.affectedServices.slice(0, 5).map((svc) => `    ${svc}`) || ["    -"]),
        "  Signals",
        ...topSignals.map((sig) => `    ${sig.label} (${sig.severity}${formatSignalScoreTag(sig)})`),
        "  Root causes",
        ...(result.assessment.rootCauseCandidates.length
          ? result.assessment.rootCauseCandidates.slice(0, 3).map((r) => `    ${r.id} (${Math.round(r.confidence * 100)}%)`)
          : ["    No dominant root cause pattern identified."]),
        "  Next actions",
        ...(ai.recommendedChecks?.slice(0, 3).map((a) => `    ${a}`) || ["    -"]),
      ];
    },
    side: (result) => [
      "Mind map context",
      "Hierarchical view of incident.",
      "",
      "Web UI",
      "solidx analyze <file> --web",
      "Opens interactive mind map in browser.",
    ],
  },
  signals: {
    id: "signals",
    title: "Signals",
    description: "Heuristic and anomaly signals ranked by evidence.",
    main: (result, filter, search) => {
      const lines = [...result.signals]
        .sort((a, b) => (b.score ?? b.count ?? 0) - (a.score ?? a.count ?? 0))
        .map((signal) => {
          const scoreTag = formatSignalScoreTag(signal);
          return `[${signal.severity}] ${signal.label} | score ${signal.score ?? signal.count ?? 1}${scoreTag}${signal.description ? ` | ${signal.description}` : ""}`;
        });
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
        (event, idx) => {
          const scope = event.host ? `[${event.host}] ${event.service}` : event.service;
          return `${String(idx + 1).padStart(4)} ${scope} [${event.severity}] ${event.timestamp} ${event.message}`;
        }
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
          "You can still investigate using timeline, signals, trace graph, and evidence.",
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
      "r - Incident summary",
      "c - Root cause analysis",
      "i - Interview STAR story",
      "T - Technical timeline",
      "",
      "Export",
      "e - export (JSON/Markdown/HTML/PDF*)",
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
          traceGraph: result.schema.traceGraph?.edges?.length ?? 0,
          signals: result.schema.signals.length,
          mlEnrichment: result.mlEnrichment?.available ? result.mlEnrichment.modelType : "none",
          parseCoverage: result.diagnostics.parseCoverage ?? "n/a",
          serviceCoverage: result.diagnostics.serviceCoverage ?? "n/a",
          timestampCoverage: result.diagnostics.timestampCoverage ?? "n/a",
          evidenceDensity: result.diagnostics.evidenceDensity ?? "n/a",
          ambiguityFlags: result.diagnostics.ambiguityFlags ?? [],
        },
        null,
        2
      ).split("\n");
      const candidateBreakdowns =
        result.diagnostics.scoreBreakdowns?.slice(0, 5).map((c, idx) =>
          `${idx + 1}. ${c.candidateId} | weighted ${fmtPct(c.weightedScore)} | h:${fmtPct(c.breakdown.heuristicScore)} topo:${fmtPct(c.breakdown.topologyScore)} temp:${fmtPct(c.breakdown.temporalScore)} sev:${fmtPct(c.breakdown.severityScore)} ml:${fmtPct(c.breakdown.mlAnomalyScore)}`
        ) ?? [];
      const propagationExplain = result.traceGraph.edges.slice(0, 5).map((e, idx) => {
        const reason = e.transitionReason ?? "sequence-inference";
        return `${idx + 1}. ${e.from} -> ${e.to} | ${e.annotation} | reason=${reason} | temporal=${fmtPct(e.temporalConfidence)} | evidence=${e.count}`;
      });
      return [
        "Schema snapshot",
        ...schemaLines,
        "",
        "Candidate scoring breakdown",
        ...(candidateBreakdowns.length ? candidateBreakdowns : ["No score breakdowns available."]),
        "",
        "Propagation explainability",
        ...(propagationExplain.length ? propagationExplain : ["No propagation edges inferred."]),
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
      `ML model: ${result.diagnostics.mlModel ?? "none"}`,
      `ML contribution: ${result.diagnostics.mlContribution ?? "n/a"}`,
      "",
      "Debug",
      "Verbose mode shows typed error details.",
    ],
  },
};

