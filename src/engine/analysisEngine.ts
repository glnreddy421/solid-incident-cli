import { randomUUID } from "crypto";
import type { AnalysisResult, AppMode, FlowEdge, IncidentSummary, InputSource, RawLogLine, TimelineEntry } from "../contracts/index.js";
import { SolidError } from "../contracts/index.js";
import { parseLines } from "../utils/parser.js";
import { runMockAnalysis } from "../services/mockAnalysis.js";

function inferFlow(timeline: TimelineEntry[]): FlowEdge[] {
  const edgeCounts = new Map<string, number>();
  for (let i = 1; i < timeline.length; i++) {
    const prev = timeline[i - 1];
    const curr = timeline[i];
    if (prev.service === curr.service) continue;
    const key = `${prev.service}->${curr.service}`;
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
  }

  return [...edgeCounts.entries()].map(([key, count]) => {
    const [from, to] = key.split("->");
    const confidence = Math.min(0.95, 0.45 + count * 0.1);
    return { from, to, count, confidence };
  });
}

function toTimeline(rawLines: RawLogLine[]): TimelineEntry[] {
  const parsed = parseLines(rawLines);
  return parsed.map((e, idx) => ({
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

function buildSummary(timeline: TimelineEntry[], fallback: ReturnType<typeof runMockAnalysis>["summary"]): IncidentSummary {
  const affectedServices = [...new Set(timeline.map((t) => t.service))].filter(Boolean);
  const trigger = timeline.find((t) => t.anomaly) ?? timeline[0];
  const start = timeline[0]?.timestamp ?? "unknown";
  const end = timeline[timeline.length - 1]?.timestamp ?? "unknown";

  return {
    incidentSummary: fallback.whatHappened,
    triggerEvent: trigger ? `${trigger.service}: ${trigger.message}` : "No trigger event identified",
    confidence: fallback.confidence,
    affectedServices,
    incidentWindow: { start, end },
  };
}

export interface EngineAnalyzeInput {
  rawLines: RawLogLine[];
  inputSources: InputSource[];
  mode: AppMode;
}

export function analyzeLocally(input: EngineAnalyzeInput): AnalysisResult {
  if (input.rawLines.length === 0) {
    throw new SolidError("EMPTY_INPUT", "No logs were provided for analysis.", { recoverable: true });
  }

  const mock = runMockAnalysis(input.rawLines);
  const timeline = toTimeline(input.rawLines);
  const flow = inferFlow(timeline);
  const summary = buildSummary(timeline, mock.summary);
  const warnings: string[] = [];

  if (timeline.length === 0) {
    warnings.push("No structured events could be parsed from the provided logs.");
  }

  return {
    mode: input.mode,
    inputSources: input.inputSources,
    summary,
    timeline,
    flow,
    rawEvents: timeline,
    signals: mock.signals.map((s) => ({ ...s, score: s.count ?? 1 })),
    ai: {
      available: false,
      rootCauseCandidates: [mock.summary.likelyRootCause],
      followUpQuestions: [],
      recommendedChecks: mock.summary.suggestedNextSteps,
      reports: {},
      warning: "AI analysis has not been requested yet.",
    },
    schema: {
      schemaVersion: "1.0.0",
      generatedAt: new Date().toISOString(),
      timeline,
      flow,
      signals: mock.signals.map((s) => ({ ...s, score: s.count ?? 1 })),
      summary,
    },
    diagnostics: {
      warnings,
      errors: [],
      transport: {
        backendReachable: false,
      },
    },
    metadata: {
      rawLineCount: input.rawLines.length,
      createdAt: new Date().toISOString(),
    },
  };
}

