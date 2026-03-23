import type { AiAnalysis, AnalysisResult } from "../contracts/model.js";
import { SolidError } from "../contracts/errors.js";
import { aiPrimaryHeadline } from "../utils/enrich/aiPresentation.js";
import { getProvider } from "./providerRegistry.js";
import { buildIncidentEnrichmentPayload } from "./payload/buildIncidentPayload.js";
import { buildPrompt } from "./prompting/buildPrompt.js";
import type { EnrichmentProviderConfig, EnrichmentResult, EnrichmentStyle } from "./types.js";
import { BYO_OUTBOUND_LLM_NOTICE, parseEnrichHeaders, readOptionalEnrichTextFile } from "./enrichCliShared.js";

const STYLES: EnrichmentStyle[] = ["briefing", "rca", "executive", "runbook", "star", "car", "debug", "questions"];

/** Ordered list for TUI `n` + digit picker (1 = briefing … 8 = questions). */
export const ENRICHMENT_STYLES_ORDER: readonly EnrichmentStyle[] = STYLES;

export function enrichmentStyleAtMenuIndex(oneBased: number): EnrichmentStyle | undefined {
  if (oneBased < 1 || oneBased > STYLES.length) return undefined;
  return STYLES[oneBased - 1];
}

export function validateEnrichmentStyleInput(raw: string): EnrichmentStyle {
  return resolveStyle(raw.trim());
}

/** Options shared by `solidx enrich` and `solidx analyze --provider …`. */
export interface ByoEnrichOptions {
  provider?: string;
  url?: string;
  apiKey?: string;
  model?: string;
  style?: string;
  /** LLM HTTP timeout (ms); analyze uses --enrich-timeout, enrich uses --timeout */
  enrichTimeout?: number;
  timeout?: number;
  header?: string[];
  temperature?: number;
  maxTokens?: number;
  systemPromptFile?: string;
  promptFile?: string;
}

export function isByoEnrichConfigured(o: ByoEnrichOptions): boolean {
  const p = o.provider?.trim();
  if (!p) return false;
  if (p === "noop") return true;
  if (p === "openai-compatible") return Boolean(o.url?.trim());
  return false;
}

function resolveStyle(raw: string | undefined): EnrichmentStyle {
  const s = (raw ?? "briefing") as EnrichmentStyle;
  if (!STYLES.includes(s)) {
    throw new SolidError("INVALID_FLAGS", `Invalid enrichment --style "${raw}".`, {
      recoverable: true,
      details: `Use one of: ${STYLES.join(", ")}`,
    });
  }
  return s;
}

function resolveTimeoutMs(o: ByoEnrichOptions): number {
  const v = o.enrichTimeout ?? o.timeout;
  if (v == null || !Number.isFinite(v)) return 45_000;
  return Math.max(1000, Math.floor(v));
}

/**
 * Maps BYO `EnrichmentResult` text into `AiAnalysis` fields used by TUI / web / JSON.
 */
export function applyEnrichmentResultToAi(base: AiAnalysis, enrichment: EnrichmentResult): AiAnalysis {
  const text = enrichment.content.trim();
  const headline =
    enrichment.sections?.map((s) => s.body.trim()).find(Boolean) || text.slice(0, 2000) || text;
  return {
    ...base,
    available: true,
    enrichmentLoading: false,
    enrichmentPending: false,
    summary: headline.slice(0, 800),
    enrichedSummary: text,
    operatorNarrative: text,
    timelineNarrative: enrichment.sections?.find((s) => /timeline|sequence|events/i.test(s.title))?.body ?? "",
    rootCauseCandidates: base.rootCauseCandidates,
    followUpQuestions: base.followUpQuestions,
    recommendedChecks: base.recommendedChecks,
    reports: base.reports,
    warning: undefined,
    enrichResponseVersion: "2.0",
  };
}

/**
 * For live tail: keep engine-derived `ai` fields but overlay last successful BYO snapshot.
 */
export function mergeEngineAiWithEnriched(engineDefault: AiAnalysis, enriched: AiAnalysis): AiAnalysis {
  return {
    ...engineDefault,
    available: enriched.available,
    summary: enriched.summary ?? engineDefault.summary,
    enrichedSummary: enriched.enrichedSummary ?? enriched.summary,
    operatorNarrative: enriched.operatorNarrative ?? enriched.enrichedSummary,
    timelineNarrative: enriched.timelineNarrative ?? engineDefault.timelineNarrative,
    rootCauseCandidates: enriched.rootCauseCandidates?.length ? enriched.rootCauseCandidates : engineDefault.rootCauseCandidates,
    followUpQuestions: enriched.followUpQuestions?.length ? enriched.followUpQuestions : engineDefault.followUpQuestions,
    recommendedChecks: enriched.recommendedChecks?.length ? enriched.recommendedChecks : engineDefault.recommendedChecks,
    rankedRootCauseCandidates: enriched.rankedRootCauseCandidates ?? engineDefault.rankedRootCauseCandidates,
    refinedRecommendedChecks: enriched.refinedRecommendedChecks ?? engineDefault.refinedRecommendedChecks,
    caveats: enriched.caveats ?? engineDefault.caveats,
    confidenceStatement: enriched.confidenceStatement ?? engineDefault.confidenceStatement,
    reports: { ...engineDefault.reports, ...enriched.reports },
    warning: enriched.warning ?? engineDefault.warning,
    enrichResponseVersion: enriched.enrichResponseVersion ?? engineDefault.enrichResponseVersion,
    enrichmentLoading: enriched.enrichmentLoading,
    enrichmentPending: enriched.enrichmentPending ?? false,
    followUpArtifacts:
      enriched.followUpArtifacts && enriched.followUpArtifacts.length
        ? enriched.followUpArtifacts
        : engineDefault.followUpArtifacts,
    byoProviderNotice: enriched.byoProviderNotice ?? engineDefault.byoProviderNotice,
  };
}

const FOLLOW_UP_PRIOR_MAX = 14_000;

/**
 * Explicit follow-up BYO call: keeps primary `ai` narrative, appends to `followUpArtifacts`.
 * Prompt anchors on primary headline + full structured payload.
 */
export async function executeByoFollowUp(
  result: AnalysisResult,
  o: ByoEnrichOptions,
  style: EnrichmentStyle,
): Promise<void> {
  const providerName = o.provider?.trim();
  if (!providerName) {
    throw new SolidError("INVALID_FLAGS", "Missing --provider for follow-up.", { recoverable: true });
  }
  if (providerName === "openai-compatible" && !o.url?.trim()) {
    throw new SolidError("INVALID_FLAGS", "openai-compatible requires --url.", { recoverable: true });
  }

  const primary = aiPrimaryHeadline(result.ai).trim() || (result.ai.enrichedSummary ?? "").trim();
  const payload = buildIncidentEnrichmentPayload(result, { inputLabel: `follow-up:${style}` });
  const config: EnrichmentProviderConfig = {
    provider: providerName as EnrichmentProviderConfig["provider"],
    url: o.url,
    apiKey: o.apiKey,
    model: o.model,
    timeoutMs: resolveTimeoutMs(o),
    headers: parseEnrichHeaders(o.header),
    temperature: o.temperature,
    maxTokens: o.maxTokens,
  };

  const provider = getProvider(config);
  const prompt = await buildPrompt({
    style,
    payload,
    systemPromptOverride: await readOptionalEnrichTextFile(o.systemPromptFile),
    priorNarrativeForFollowUp: primary ? primary.slice(0, FOLLOW_UP_PRIOR_MAX) : undefined,
  });

  const enrichment = await provider.enrich({
    style,
    payload,
    config,
    prompt,
  });

  const text = enrichment.content.trim();
  const entry = { style, content: text, generatedAt: new Date().toISOString() };
  const prev = result.ai.followUpArtifacts ?? [];
  result.ai.followUpArtifacts = [...prev, entry];
  if (providerName === "openai-compatible") {
    result.ai.byoProviderNotice = BYO_OUTBOUND_LLM_NOTICE;
  }
}

/**
 * Runs BYO provider enrich and mutates `result.ai` in place.
 */
export async function applyByoEnrichmentToAnalysisResult(
  result: AnalysisResult,
  o: ByoEnrichOptions,
  inputLabel: string,
): Promise<EnrichmentResult> {
  const providerName = o.provider?.trim();
  if (!providerName) {
    throw new SolidError("INVALID_FLAGS", "Missing --provider.", { recoverable: true });
  }
  if (providerName === "openai-compatible" && !o.url?.trim()) {
    throw new SolidError("INVALID_FLAGS", "openai-compatible requires --url.", { recoverable: true });
  }

  const style = resolveStyle(o.style);
  const payload = buildIncidentEnrichmentPayload(result, { inputLabel });
  const config: EnrichmentProviderConfig = {
    provider: providerName as EnrichmentProviderConfig["provider"],
    url: o.url,
    apiKey: o.apiKey,
    model: o.model,
    timeoutMs: resolveTimeoutMs(o),
    headers: parseEnrichHeaders(o.header),
    temperature: o.temperature,
    maxTokens: o.maxTokens,
  };

  const provider = getProvider(config);
  const prompt = await buildPrompt({
    style,
    payload,
    systemPromptOverride: await readOptionalEnrichTextFile(o.systemPromptFile),
    userPromptOverride: await readOptionalEnrichTextFile(o.promptFile),
  });

  const enrichment = await provider.enrich({
    style,
    payload,
    config,
    prompt,
  });

  result.ai = applyEnrichmentResultToAi(result.ai, enrichment);
  if (providerName === "openai-compatible") {
    result.ai.byoProviderNotice = BYO_OUTBOUND_LLM_NOTICE;
  }
  return enrichment;
}
