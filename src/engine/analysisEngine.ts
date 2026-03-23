import { randomUUID } from "crypto";
import type {
  AnalysisContext,
  AnalysisResult,
  AppMode,
  FlowEdge,
  IncidentSummary,
  InputSource,
  RawLogLine,
  Severity,
  Signal,
  TimelineEntry,
  TraceGraph,
  TraceGraphEdge,
  TriggerCandidate,
} from "../contracts/index.js";
import { SolidError } from "../contracts/index.js";
import { parseLines } from "../utils/parser.js";
import { EVENT_TYPE_PATTERNS } from "../utils/constants.js";
import { runMlEnrichment, blendScores } from "./mlEnrichment.js";
import { deriveAssessment } from "./incidentAssessment.js";
import { normalizeTimelineEvents } from "./normalizers/eventNormalizer.js";
import { detectRuleSignals } from "./detectors/ruleSignalDetector.js";
import { detectTfidfClusterSignals } from "./detectors/tfidfClusterDetector.js";
import { detectPropagation } from "./propagation/propagationDetector.js";
import { rankRootCauses } from "./ranking/rootCauseRanker.js";
import { reconstructAnnotatedTimeline } from "./timeline/timelineReconstructor.js";
import { buildTrustDiagnostics } from "./diagnostics/trustDiagnostics.js";

function inferEventAnnotation(message: string): string {
  for (const { pattern, label } of EVENT_TYPE_PATTERNS) {
    if (pattern.test(message)) return label;
  }
  return "impact";
}

function buildTraceGraph(
  timeline: TimelineEntry[],
  signals: { label: string; service?: string; count?: number }[],
  mlScores?: number[]
): TraceGraph {
  let nodes = [...new Set(timeline.map((t) => t.service).filter((s) => s && s !== "unknown-service"))];
  if (nodes.length === 0 && timeline.length > 0) {
    nodes = ["unknown-service"];
  }
  const nodeSignals: Record<string, string[]> = {};
  for (const sig of signals) {
    const svc = sig.service ?? (nodes.length === 1 ? nodes[0] : timeline[0]?.service ?? "unknown-service");
    if (svc && svc !== "unknown-service") {
      if (!nodeSignals[svc]) nodeSignals[svc] = [];
      nodeSignals[svc].push(sig.label);
    }
  }
  for (const n of nodes) {
    if (!nodeSignals[n]) nodeSignals[n] = [];
  }
  if (nodes.length === 1 && signals.length > 0) {
    const single = nodes[0];
    nodeSignals[single] = signals.map((s) => s.label).slice(0, 8);
  }

  const edgeMap = new Map<string, TraceGraphEdge>();
  for (let i = 1; i < timeline.length; i++) {
    const prev = timeline[i - 1];
    const curr = timeline[i];
    if (prev.service === curr.service) continue;
    const from = prev.service || "unknown";
    const to = curr.service || "unknown";
    if (from === "unknown-service" || to === "unknown-service") continue;

    const key = `${from}->${to}`;
    const annotation = inferEventAnnotation(curr.message);
    const heuristicScore = 0.5 + (curr.anomaly ? 0.2 : 0) + (annotation !== "impact" ? 0.15 : 0);
    const mlScore = mlScores?.[i];
    const blended = mlScore != null ? blendScores(heuristicScore, mlScore, 0.35) : heuristicScore;
    const existing = edgeMap.get(key);
    if (existing) {
      existing.count += 1;
      existing.confidence = Math.min(0.95, existing.confidence + 0.05);
      existing.heuristicScore = Math.min(0.95, (existing.heuristicScore ?? 0.5) + 0.05);
      if (mlScore != null) existing.mlScore = Math.min(0.95, (existing.mlScore ?? 0.5) + mlScore * 0.1);
      if (annotation !== "impact" && existing.annotation === "impact") existing.annotation = annotation;
    } else {
      edgeMap.set(key, {
        from,
        to,
        annotation,
        count: 1,
        confidence: Math.min(0.95, 0.5 + 0.1 * (curr.anomaly ? 2 : 1)),
        heuristicScore: Math.min(0.95, heuristicScore),
        mlScore: mlScore,
      });
    }
  }

  let edges = [...edgeMap.values()];
  let inferredFromSequence = false;

  if (edges.length === 0 && nodes.length >= 2) {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const t of timeline) {
      if (t.service && t.service !== "unknown-service" && !seen.has(t.service)) {
        seen.add(t.service);
        order.push(t.service);
      }
    }
    if (order.length >= 2) {
      inferredFromSequence = true;
      edges = order.slice(0, -1).map((from, i) => {
        const to = order[i + 1];
        const toEvents = timeline.filter((e) => e.service === to);
        const lastMsg = toEvents[toEvents.length - 1]?.message ?? "impact";
        return {
          from,
          to,
          annotation: inferEventAnnotation(lastMsg),
          count: 1,
          confidence: 0.55,
          heuristicScore: 0.5,
          keySignals: [...(nodeSignals[to] ?? [])].slice(0, 3),
        };
      });
    }
  }

  const scoreOf = (e: TraceGraphEdge) =>
    e.mlScore != null ? blendScores(e.heuristicScore ?? 0.5, e.mlScore, 0.35) : (e.heuristicScore ?? e.confidence);
  edges.sort((a, b) => scoreOf(b) - scoreOf(a));

  const triggerCandidates: TriggerCandidate[] = [];
  const firstAnomaly = timeline.find((t) => t.anomaly);
  if (firstAnomaly) {
    const firstMsg = firstAnomaly.message.slice(0, 80);
    triggerCandidates.push({
      service: firstAnomaly.service,
      event: firstMsg,
      confidence: firstAnomaly.severity === "critical" ? 0.9 : firstAnomaly.severity === "error" ? 0.8 : 0.7,
    });
  }
  const topSignal = signals.find((s) => s.service && s.count && s.count >= 2);
  if (topSignal?.service && !triggerCandidates.some((t) => t.service === topSignal.service)) {
    triggerCandidates.push({
      service: topSignal.service,
      event: topSignal.label,
      confidence: 0.75,
    });
  }
  if (triggerCandidates.length === 0 && timeline[0]) {
    triggerCandidates.push({
      service: timeline[0].service,
      event: timeline[0].message.slice(0, 80),
      confidence: 0.6,
    });
  }

  return {
    nodes,
    edges,
    triggerCandidates,
    nodeSignals,
    inferredFromSequence,
  };
}

function traceGraphToFlow(trace: TraceGraph): FlowEdge[] {
  return trace.edges.map((e) => ({
    from: e.from,
    to: e.to,
    count: e.count,
    confidence: e.confidence,
  }));
}

function inferFlow(timeline: TimelineEntry[]): FlowEdge[] {
  const edgeCounts = new Map<string, number>();
  for (let i = 1; i < timeline.length; i++) {
    const prev = timeline[i - 1];
    const curr = timeline[i];
    if (prev.service === curr.service) continue;
    const key = `${prev.service}->${curr.service}`;
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
  }

  const primary = [...edgeCounts.entries()].map(([key, count]) => {
    const [from, to] = key.split("->");
    const confidence = Math.min(0.95, 0.45 + count * 0.1);
    return { from, to, count, confidence };
  });

  if (primary.length > 0) return primary;

  const distinct = [...new Set(timeline.map((t) => t.service).filter(Boolean))];
  if (distinct.length < 2) return [];

  const order: string[] = [];
  const seen = new Set<string>();
  for (const t of timeline) {
    if (t.service && !seen.has(t.service)) {
      seen.add(t.service);
      order.push(t.service);
    }
  }
  return order.slice(0, -1).map((from, i) => ({
    from,
    to: order[i + 1],
    count: 1,
    confidence: 0.5,
  }));
}

function toTimeline(rawLines: RawLogLine[]): TimelineEntry[] {
  const parsed = parseLines(rawLines);
  return parsed.map((e, idx) => ({
    ...extractRawMeta(rawLines.find((r) => r.lineNumber === e.lineNumber)?.line),
    id: randomUUID(),
    timestamp: e.timestamp,
    service: e.service,
    severity: e.severity,
    message: e.message,
    lineNumber: e.lineNumber,
    anomaly: e.severity === "error" || e.severity === "critical" || e.severity === "warning",
    isTrigger: idx === 0,
  }));
}

function extractRawMeta(line?: string): { host?: string; pid?: string } {
  if (!line) return {};
  const hostMatch = line.match(/^\w{3}\s+\d+\s+\d+:\d+:\d+\s+([^\s]+)\s+/);
  const pidMatch = line.match(/\[([0-9]+)\]/);
  return {
    host: hostMatch?.[1],
    pid: pidMatch?.[1],
  };
}

export interface EngineAnalyzeInput {
  rawLines: RawLogLine[];
  inputSources: InputSource[];
  mode: AppMode;
  /** Propagated into `result.metadata` for report state (live vs final wording). */
  analysisContext?: AnalysisContext;
}

export function analyzeLocally(input: EngineAnalyzeInput): AnalysisResult {
  if (input.rawLines.length === 0) {
    throw new SolidError("EMPTY_INPUT", "No logs were provided for analysis.", { recoverable: true });
  }

  const timeline = toTimeline(input.rawLines);
  const parsedEvents = normalizeTimelineEvents(timeline, input.rawLines);
  const ruleSignals = detectRuleSignals(parsedEvents);
  const tfidfSignals = detectTfidfClusterSignals(parsedEvents);
  const allSignals = [...ruleSignals, ...tfidfSignals];
  const mlEnrichment = runMlEnrichment(timeline);
  const propagationEdges = detectPropagation(parsedEvents);
  const traceGraph = propagationEdges.length > 0
    ? {
        nodes: [...new Set(parsedEvents.map((e) => e.service).filter(Boolean))],
        edges: propagationEdges,
        triggerCandidates: [],
        inferredFromSequence: false,
      }
    : buildTraceGraph(timeline, allSignals, mlEnrichment.eventScores);
  const flow =
    traceGraph.edges.length > 0 ? traceGraphToFlow(traceGraph) : inferFlow(timeline);
  const enrichedSignals = enrichSignalsWithMl(allSignals, timeline.map((t) => ({ message: t.message, service: t.service })), mlEnrichment);
  const rankedCandidatesRaw = rankRootCauses(parsedEvents, enrichedSignals, propagationEdges, mlEnrichment.eventScores);
  const rankedCandidates = rankedCandidatesRaw.length
    ? rankedCandidatesRaw
    : [{
        id: "no_dominant_root_cause",
        label: "no dominant root cause",
        confidence: 0.35,
        weightedScore: 0.35,
        heuristicScore: 0.2,
        topologyScore: 0,
        temporalScore: 0.2,
        severityScore: 0.2,
        mlAnomalyScore: 0.2,
        evidenceCount: 0,
        directEvidence: ["No dominant root cause pattern identified."],
        relatedSignals: [],
        affectedServices: [],
      }];
  const reconstructedTimeline = reconstructAnnotatedTimeline(parsedEvents);
  const diagnosticsTrust = buildTrustDiagnostics(parsedEvents, enrichedSignals);
  const assessmentBase = deriveAssessment({ timeline, traceGraph, signals: enrichedSignals, rawLines: input.rawLines });
  const assessment = {
    ...assessmentBase,
    rootCauseCandidates: rankedCandidates.map((c) => ({
      id: c.id,
      label: c.label,
      confidence: c.confidence,
      weightedScore: c.weightedScore,
      scoreBreakdown: {
        heuristicScore: c.heuristicScore,
        topologyScore: c.topologyScore,
        temporalScore: c.temporalScore,
        severityScore: c.severityScore,
        mlAnomalyScore: c.mlAnomalyScore,
      },
      evidence: c.directEvidence[0] ?? c.relatedSignals[0] ?? "No direct evidence extracted.",
      evidenceCount: c.evidenceCount,
      affectedServices: c.affectedServices,
    })),
    reconstructedTimeline,
    propagationChain: propagationEdges.map(
      (e) => `${e.from} -> ${e.to} | ${e.annotation} | reason=${e.transitionReason ?? "unknown"} | temporal=${Math.round((e.temporalConfidence ?? 0) * 100)}% | evidence=${e.count}`
    ),
  };
  const confidence = deriveConfidence(assessment.rootCauseCandidates, diagnosticsTrust, assessment.severity);
  const incidentWindow = deriveStableIncidentWindow(timeline);
  const summary: IncidentSummary = {
    incidentSummary: assessment.summaryNarrative,
    triggerEvent: formatTriggerLabel(timeline.find((t) => t.anomaly) ?? timeline[0]),
    confidence,
    affectedServices: [...new Set(timeline.map((t) => t.service).filter(Boolean))],
    incidentWindow,
  };
  const warnings: string[] = [];

  if (timeline.length === 0) {
    warnings.push("No structured events could be parsed from the provided logs.");
  }

  return {
    mode: input.mode,
    inputSources: input.inputSources,
    summary,
    assessment,
    analysisWindow: {
      start: incidentWindow.start,
      end: incidentWindow.end,
      durationSeconds: deriveDurationSeconds(incidentWindow.start, incidentWindow.end),
    },
    parsedEvents,
    timeline,
    flow,
    traceGraph,
    rawEvents: timeline,
    signals: enrichedSignals,
    ai: {
      available: false,
      rootCauseCandidates: assessment.rootCauseCandidates.map((r) => r.id),
      followUpQuestions: [],
      recommendedChecks: assessment.recommendedActions,
      reports: {},
      warning: "AI analysis has not been requested yet.",
    },
    schema: {
      schemaVersion: "1.0.0",
      generatedAt: new Date().toISOString(),
      timeline,
      flow,
      traceGraph,
      assessment,
      signals: enrichedSignals,
      summary,
    },
    diagnostics: {
      warnings,
      errors: [],
      transport: {
        backendReachable: false,
      },
      scoreBreakdowns: assessment.rootCauseCandidates.map((c) => ({
        candidateId: c.id,
        weightedScore: c.weightedScore ?? c.confidence,
        breakdown: c.scoreBreakdown ?? {
          heuristicScore: 0,
          topologyScore: 0,
          temporalScore: 0,
          severityScore: 0,
          mlAnomalyScore: 0,
        },
      })),
      parseCoverage: diagnosticsTrust.parseCoverage,
      timestampCoverage: diagnosticsTrust.timestampCoverage,
      serviceCoverage: diagnosticsTrust.serviceCoverage,
      severityCoverage: diagnosticsTrust.severityCoverage,
      evidenceDensity: diagnosticsTrust.evidenceDensity,
      ambiguityFlags: diagnosticsTrust.ambiguityFlags,
      mlContribution: 0.1,
      mlModel: mlEnrichment.modelType,
      mlNotes: mlEnrichment.available
        ? "Observed sequence rarity and anomaly cluster used for ranking boost."
        : "ML fallback mode; deterministic heuristics dominate.",
    },
    metadata: {
      rawLineCount: input.rawLines.length,
      createdAt: new Date().toISOString(),
      ...(input.analysisContext ? { analysisContext: input.analysisContext } : {}),
    },
    mlEnrichment,
  };
}

function deriveDurationSeconds(start: string, end: string): number {
  if (start.startsWith("line:") || end.startsWith("line:")) {
    const startLine = Number(start.replace("line:", "").trim());
    const endLine = Number(end.replace("line:", "").trim());
    if (Number.isFinite(startLine) && Number.isFinite(endLine) && endLine >= startLine) {
      return endLine - startLine;
    }
    return 0;
  }
  if (start === "unknown" || end === "unknown") return 0;
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  return Math.floor((e - s) / 1000);
}

function deriveStableIncidentWindow(timeline: TimelineEntry[]): { start: string; end: string } {
  if (!timeline.length) return { start: "line:0", end: "line:0" };
  const withTs = timeline.filter((e) => e.timestamp !== "unknown");
  if (withTs.length >= 2) {
    return {
      start: withTs[0].timestamp,
      end: withTs[withTs.length - 1].timestamp,
    };
  }
  if (withTs.length === 1) {
    return {
      start: withTs[0].timestamp,
      end: withTs[0].timestamp,
    };
  }
  return {
    start: `line:${timeline[0].lineNumber ?? 1}`,
    end: `line:${timeline[timeline.length - 1].lineNumber ?? timeline.length}`,
  };
}

function deriveConfidence(
  candidates: Array<{ confidence: number }>,
  trust: { parseCoverage: number; timestampCoverage: number; serviceCoverage: number; evidenceDensity: number; ambiguityFlags: string[] },
  severity: string
): number {
  const top = candidates[0]?.confidence ?? 0.4;
  const second = candidates[1]?.confidence ?? 0.3;
  const separation = Math.max(0, top - second);
  const trustFactor =
    (trust.parseCoverage * 0.25 + trust.timestampCoverage * 0.25 + trust.serviceCoverage * 0.25 + Math.min(100, trust.evidenceDensity * 100) * 0.25) /
    100;
  const severityBoost = severity === "none" ? 0.08 : severity === "critical" ? 0.06 : 0.04;
  const ambiguityPenalty = Math.min(0.3, trust.ambiguityFlags.length * 0.05);
  const weakCoveragePenalty =
    (trust.parseCoverage < 70 ? 0.12 : 0) +
    (trust.timestampCoverage < 70 ? 0.12 : 0) +
    (trust.serviceCoverage < 70 ? 0.12 : 0);
  const conf = (top * 0.5 + separation * 0.25 + trustFactor * 0.25 + severityBoost) - ambiguityPenalty - weakCoveragePenalty;
  return Math.max(15, Math.min(98, Math.round(conf * 100)));
}

function formatTriggerLabel(trigger?: TimelineEntry): string {
  if (!trigger) return "No trigger event identified";
  const clean = trigger.message.replace(/\s+/g, " ").trim().slice(0, 80);
  return `${trigger.service} -> ${clean}`;
}

function enrichSignalsWithMl(
  signals: Signal[],
  events: { message: string; service?: string }[],
  ml: { eventScores: number[]; available: boolean }
): Signal[] {
  if (!ml.available || ml.eventScores.length !== events.length) {
    return signals.map((s) => ({ ...s, score: s.count ?? 1 })) as Signal[];
  }
  return signals.map((sig) => {
    const heuristicScore = (sig.count ?? 1) / 10;
    const matchingIndices = events
      .map((e, i) => (e.message?.toLowerCase().includes(sig.label.split(" ")[0]?.toLowerCase()) ? i : -1))
      .filter((i) => i >= 0);
    const avgMl = matchingIndices.length > 0
      ? matchingIndices.reduce((s, i) => s + ml.eventScores[i], 0) / matchingIndices.length
      : ml.eventScores.reduce((a, b) => a + b, 0) / ml.eventScores.length;
    const blended = blendScores(Math.min(1, heuristicScore), avgMl, 0.4);
    return {
      ...sig,
      score: Math.round(blended * 10) || (sig.count ?? 1),
      mlScore: avgMl,
    } as Signal;
  });
}

