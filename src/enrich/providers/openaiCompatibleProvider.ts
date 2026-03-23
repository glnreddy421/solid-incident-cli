import { SolidError } from "../../contracts/errors.js";
import type {
  EnrichmentProvider,
  EnrichmentRequest,
  EnrichmentResult,
} from "../types.js";

interface OpenAiChatCompletionChoice {
  message?: {
    content?: string | Array<{ type?: string; text?: string }>;
  };
}

interface OpenAiChatCompletionResponse {
  id?: string;
  model?: string;
  choices?: OpenAiChatCompletionChoice[];
}

function parseHeaders(rawHeaders: Record<string, string> | undefined): Record<string, string> {
  if (!rawHeaders) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    const trimmedKey = key.trim();
    const trimmedValue = value.trim();
    if (!trimmedKey) continue;
    out[trimmedKey] = trimmedValue;
  }
  return out;
}

export function normalizeChatCompletionsEndpoint(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch (error) {
    throw new SolidError("INVALID_FLAGS", "Invalid --url value. Expected an absolute URL.", {
      recoverable: true,
      cause: error,
    });
  }

  const pathname = parsed.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/chat/completions")) {
    return parsed.toString();
  }
  if (pathname.endsWith("/v1")) {
    parsed.pathname = `${pathname}/chat/completions`;
    return parsed.toString();
  }
  parsed.pathname = `${pathname || ""}/v1/chat/completions`;
  return parsed.toString();
}

function extractResponseText(payload: OpenAiChatCompletionResponse): string | undefined {
  const first = payload.choices?.[0]?.message?.content;
  if (typeof first === "string") return first.trim();
  if (Array.isArray(first)) {
    const text = first
      .map((entry) => (entry.type === "text" || !entry.type ? entry.text : ""))
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join("\n")
      .trim();
    return text || undefined;
  }
  return undefined;
}

export class OpenAiCompatibleProvider implements EnrichmentProvider {
  readonly name = "openai-compatible" as const;

  async enrich(request: EnrichmentRequest): Promise<EnrichmentResult> {
    if (!request.config.url) {
      throw new SolidError("INVALID_FLAGS", "Provider 'openai-compatible' requires --url.", {
        recoverable: true,
      });
    }

    const endpoint = normalizeChatCompletionsEndpoint(request.config.url);
    const controller = new AbortController();
    const timeoutMs = request.config.timeoutMs ?? 45000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(request.config.apiKey ? { Authorization: `Bearer ${request.config.apiKey}` } : {}),
          ...parseHeaders(request.config.headers),
        },
        body: JSON.stringify({
          model: request.config.model,
          messages: [
            { role: "system", content: request.prompt.systemPrompt },
            { role: "user", content: request.prompt.userPrompt },
          ],
          temperature: request.config.temperature,
          max_tokens: request.config.maxTokens,
        }),
      });

      const latencyMs = Date.now() - started;
      const payload = (await response.json().catch(() => undefined)) as OpenAiChatCompletionResponse | undefined;

      if (!response.ok) {
        const errMessage =
          payload && typeof payload === "object" && "error" in payload
            ? String((payload as { error?: { message?: string } }).error?.message ?? "")
            : "";
        const statusHint =
          response.status === 401 || response.status === 403
            ? "Unauthorized request. Check --api-key and endpoint permissions."
            : response.status === 404
              ? "Model not found or endpoint path is invalid."
            : `Provider returned ${response.status}.`;
        throw new SolidError("BACKEND_UNAVAILABLE", statusHint, {
          recoverable: true,
          details: `endpoint=${endpoint}, latencyMs=${latencyMs}${errMessage ? `, error=${errMessage}` : ""}`,
        });
      }

      if (!payload || typeof payload !== "object") {
        throw new SolidError("BACKEND_MALFORMED_RESPONSE", "Provider returned invalid JSON response.", {
          recoverable: true,
          details: `endpoint=${endpoint}`,
        });
      }

      const text = extractResponseText(payload);
      if (!text) {
        throw new SolidError("BACKEND_MALFORMED_RESPONSE", "Provider response did not include message content.", {
          recoverable: true,
          details: `endpoint=${endpoint}`,
        });
      }

      return {
        provider: {
          provider: this.name,
          model: payload.model ?? request.config.model,
          endpoint,
          latencyMs,
        },
        style: request.style,
        schemaVersion: request.payload.schemaVersion,
        generatedAt: new Date().toISOString(),
        content: text,
        format: "markdown",
      };
    } catch (error) {
      if (error instanceof SolidError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new SolidError("BACKEND_TIMEOUT", `Enrichment request timed out after ${timeoutMs}ms.`, {
          recoverable: true,
          details: `endpoint=${endpoint}`,
          cause: error,
        });
      }
      throw new SolidError("BACKEND_UNAVAILABLE", "OpenAI-compatible provider request failed.", {
        recoverable: true,
        details: `endpoint=${endpoint}. Failed to connect to provider endpoint.`,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
