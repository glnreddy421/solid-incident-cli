import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleProvider, normalizeChatCompletionsEndpoint } from "../../src/enrich/providers/openaiCompatibleProvider.js";
import type { EnrichmentRequest } from "../../src/enrich/types.js";
import { SolidError } from "../../src/contracts/errors.js";

const baseRequest: EnrichmentRequest = {
  style: "rca",
  payload: {
    schemaVersion: "incident-enrichment.v1",
    generatedAt: new Date().toISOString(),
    source: { kind: "analysis-result", engineVersion: "1.0.0" },
    incident: { verdict: "INCIDENT DETECTED", severity: "high", confidence: 0.8, healthScore: 30 },
    rootCauseCandidates: [],
    affectedServices: [],
    signals: [],
    timeline: [],
    suggestedCauses: [],
    suggestedFixes: [],
    evidenceExcerpts: [],
    metadata: {
      ambiguityFlags: [],
      truncation: {
        timelineEntriesDropped: 0,
        signalsDropped: 0,
        candidatesDropped: 0,
        excerptsDropped: 0,
      },
    },
  },
  config: {
    provider: "openai-compatible",
    model: "test-model",
    url: "http://localhost:11434",
  },
  prompt: {
    systemPrompt: "system prompt",
    userPrompt: "user prompt",
  },
};

describe("normalizeChatCompletionsEndpoint", () => {
  it("normalizes base and v1 paths", () => {
    expect(normalizeChatCompletionsEndpoint("http://localhost:11434")).toBe("http://localhost:11434/v1/chat/completions");
    expect(normalizeChatCompletionsEndpoint("http://localhost:11434/v1")).toBe("http://localhost:11434/v1/chat/completions");
    expect(normalizeChatCompletionsEndpoint("http://localhost:11434/v1/chat/completions")).toBe(
      "http://localhost:11434/v1/chat/completions",
    );
  });
});

describe("OpenAiCompatibleProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("constructs chat completions request and normalizes output", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: "server-model",
        choices: [{ message: { content: "Generated response" } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiCompatibleProvider();
    const result = await provider.enrich({
      ...baseRequest,
      config: {
        ...baseRequest.config,
        apiKey: "abc",
        headers: { "X-Test": "1" },
      },
    });

    expect(result.content).toContain("Generated response");
    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe("http://localhost:11434/v1/chat/completions");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe("test-model");
    expect(Array.isArray(body.messages)).toBe(true);
  });

  it("throws clear unauthorized errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    const provider = new OpenAiCompatibleProvider();

    await expect(
      provider.enrich({ ...baseRequest, config: { ...baseRequest.config, url: "https://example.com/v1" } }),
    ).rejects.toBeInstanceOf(SolidError);
  });

  it("throws for malformed responses with missing content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [] }) }));
    const provider = new OpenAiCompatibleProvider();

    await expect(
      provider.enrich({ ...baseRequest, config: { ...baseRequest.config, url: "https://example.com/v1" } }),
    ).rejects.toBeInstanceOf(SolidError);
  });
});
