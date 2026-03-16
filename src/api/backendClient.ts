import type { AiAnalysis, IncidentSchema, ReportType } from "../contracts/index.js";
import { BackendMalformedResponseError, BackendUnavailableError } from "../contracts/index.js";

export interface BackendClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  apiKey?: string;
}

export class BackendAiClient {
  private readonly baseUrl: string | undefined;
  private readonly timeoutMs: number;
  private readonly apiKey: string | undefined;

  constructor(opts: BackendClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? process.env.SOLID_API_URL;
    this.timeoutMs = opts.timeoutMs ?? 50000;
    this.apiKey = opts.apiKey ?? process.env.SOLID_API_KEY;
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl);
  }

  async enrichIncident(schema: IncidentSchema): Promise<AiAnalysis> {
    if (process.env.SOLID_TEST_BACKEND_DOWN === "1") {
      throw new BackendUnavailableError("Backend unavailable (forced for test).");
    }
    if (!this.baseUrl) {
      throw new BackendUnavailableError("Backend URL is not configured. Set SOLID_API_URL.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const started = Date.now();

    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/incident/enrich`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({ schema }),
      });
      const latencyMs = Date.now() - started;
      if (!response.ok) {
        throw new BackendUnavailableError(`Backend returned ${response.status}.`, `status=${response.status}, latencyMs=${latencyMs}`);
      }

      const payload = (await response.json()) as Partial<AiAnalysis>;
      if (!payload || typeof payload !== "object") {
        throw new BackendMalformedResponseError("Backend returned malformed AI analysis.");
      }

      return {
        available: true,
        summary: payload.summary ?? "AI summary unavailable.",
        timelineNarrative: payload.timelineNarrative ?? "Timeline narrative unavailable.",
        rootCauseCandidates: payload.rootCauseCandidates ?? [],
        followUpQuestions: payload.followUpQuestions ?? [],
        recommendedChecks: payload.recommendedChecks ?? [],
        reports: payload.reports ?? {},
      };
    } catch (error) {
      if (error instanceof BackendUnavailableError || error instanceof BackendMalformedResponseError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new BackendUnavailableError("Backend request timed out.", `timeoutMs=${this.timeoutMs}`, error);
      }
      throw new BackendUnavailableError("Backend request failed.", undefined, error);
    } finally {
      clearTimeout(timer);
    }
  }

  async generateReport(schema: IncidentSchema, type: ReportType): Promise<string> {
    if (!this.baseUrl) throw new BackendUnavailableError("Backend URL is not configured. Set SOLID_API_URL.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/incident/report`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({ schema, type }),
      });
      if (!response.ok) throw new BackendUnavailableError(`Backend returned ${response.status}.`);
      const payload = (await response.json()) as { body?: string };
      return payload.body ?? "";
    } catch (error) {
      if (error instanceof BackendUnavailableError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new BackendUnavailableError("Backend request timed out.", `timeoutMs=${this.timeoutMs}`, error);
      }
      throw new BackendUnavailableError("Backend report request failed.", undefined, error);
    } finally {
      clearTimeout(timer);
    }
  }
}

