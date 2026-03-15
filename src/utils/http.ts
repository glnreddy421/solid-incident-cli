/**
 * HTTP client for SOLID backend API.
 * When SOLID_API_URL is set, the CLI calls the backend instead of local mock.
 */

import type { AnalysisResult, ParsedEvent, Signal, IncidentSummary } from "./types.js";

export interface BackendAnalyzeOptions {
  baseUrl?: string;
  apiKey?: string;
  createHandoff?: boolean;
}

export interface HandoffInfo {
  token: string;
  expiresAt: string;
  webUrl: string;
}

const DEFAULT_API_URL = "https://solid-gateway-1ke3a9fi.uc.gateway.dev";

function getBaseUrl(): string | undefined {
  return process.env.SOLID_API_URL ?? DEFAULT_API_URL;
}

interface BackendAnalyzeResponse {
  ok: boolean;
  timeline: Array<{
    id: string;
    timestamp: string;
    service: string;
    severity: string;
    message: string;
    eventType?: string;
    raw?: string;
    component?: string;
  }>;
  signals: Array<{
    id: string;
    title: string;
    severity: string;
    confidence: number;
    description?: string;
    relatedServices?: string[];
    evidenceEventIndexes?: number[];
  }>;
  summary: {
    whatHappened: string;
    likelyRootCause: string;
    rootCauseConfidence: number;
    impact: string[];
    suggestedNextSteps: string[];
  };
}

function mapBackendToCliResponse(data: BackendAnalyzeResponse, rawLineCount: number): AnalysisResult {
  const events: ParsedEvent[] = data.timeline.map((evt, i) => ({
    timestamp: evt.timestamp,
    service: evt.service,
    component: evt.component,
    severity: evt.severity as ParsedEvent["severity"],
    message: evt.message,
    raw: evt.raw,
    lineNumber: i + 1,
  }));

  const signals: Signal[] = data.signals.map((s) => ({
    label: s.title,
    description: s.description,
    severity: s.severity as Signal["severity"],
    count: s.evidenceEventIndexes?.length ?? 1,
    service: s.relatedServices?.[0],
  }));

  const summary: IncidentSummary = {
    whatHappened: data.summary.whatHappened,
    likelyRootCause: data.summary.likelyRootCause,
    confidence: Math.round((data.summary.rootCauseConfidence ?? 0) * 100),
    impactedServices: data.summary.impact,
    suggestedNextSteps: data.summary.suggestedNextSteps,
  };

  return {
    events,
    signals,
    summary,
    rawLineCount,
  };
}

/** Response when createHandoff=true */
interface ApiHandoffResponse {
  ok: boolean;
  result: BackendAnalyzeResponse;
  handoff: { token: string; expiresAt: string; webUrl: string };
}

/**
 * Call backend analyze API.
 * When createHandoff=true, returns handoff info for CLI→Web handoff.
 * @throws Error if backend is not configured or request fails
 */
export async function analyzeLogsViaBackend(
  logs: string,
  options?: BackendAnalyzeOptions
): Promise<{ result: AnalysisResult; handoff?: HandoffInfo }> {
  const baseUrl = options?.baseUrl ?? getBaseUrl();
  if (!baseUrl) {
    throw new Error("SOLID_API_URL is not set. Configure it to use the backend API.");
  }

  const url = `${baseUrl.replace(/\/$/, "")}/api/analyze`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options?.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
    },
    body: JSON.stringify({
      logs,
      source: "cli",
      options: {
        includeRawEvents: true,
        includeGraph: true,
        createHandoff: options?.createHandoff ?? false,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = (err as { error?: { message?: string } })?.error?.message ?? res.statusText;
    throw new Error(`Backend error: ${msg}`);
  }

  const data = (await res.json()) as BackendAnalyzeResponse | ApiHandoffResponse;
  if (!data.ok) {
    throw new Error("Analysis failed");
  }

  const payload = "result" in data && data.result ? data.result : (data as BackendAnalyzeResponse);
  const handoff = "handoff" in data && data.handoff ? data.handoff : undefined;
  const rawLineCount = logs.trim().split(/\r?\n/).filter((l) => l.trim()).length;

  return {
    result: mapBackendToCliResponse(payload, rawLineCount),
    handoff,
  };
}

export function isBackendConfigured(): boolean {
  return true; // Always use backend (gateway URL is default)
}
