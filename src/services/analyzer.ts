/**
 * Analysis entry point. Uses backend API when SOLID_API_URL is set,
 * otherwise falls back to local mock analysis.
 */

import type { AnalysisResult } from "../utils/types.js";
import type { RawLogLine } from "../utils/types.js";
import type { HandoffInfo } from "../utils/http.js";
import { analyzeLogsViaBackend, isBackendConfigured } from "../utils/http.js";
import { runMockAnalysis } from "./mockAnalysis.js";

export interface AnalyzeOutput {
  result: AnalysisResult;
  handoff?: HandoffInfo;
}

export async function analyzeLogs(
  rawLines: RawLogLine[],
  options?: { includeRawEvents?: boolean; createHandoff?: boolean }
): Promise<AnalyzeOutput> {
  const logsText = rawLines.map((l) => l.line).join("\n");
  if (!logsText.trim()) {
    return {
      result: {
        events: [],
        signals: [],
        summary: {
          whatHappened: "No log content provided.",
          likelyRootCause: "N/A",
          confidence: 0,
          impactedServices: [],
          suggestedNextSteps: ["Provide a log file or piped input."],
        },
        rawLineCount: 0,
      },
    };
  }

  if (isBackendConfigured()) {
    const { result, handoff } = await analyzeLogsViaBackend(logsText, {
      createHandoff: options?.createHandoff,
    });
    if (!options?.includeRawEvents) {
      result.events = result.events.map(({ raw, ...e }) => e);
    }
    return { result, handoff };
  }

  const result = runMockAnalysis(rawLines);
  if (!options?.includeRawEvents) {
    result.events = result.events.map(({ raw, ...e }) => e);
  }
  return { result };
}
