import { writeFile } from "fs/promises";
import { resolve } from "path";
import { loadAnalysisJson } from "../../cli/loadAnalysisJson.js";
import { SolidError } from "../../contracts/errors.js";
import { BYO_OUTBOUND_LLM_NOTICE } from "../enrichCliShared.js";
import type { AnalysisResult } from "../../contracts/model.js";
import { applyByoEnrichmentToAnalysisResult, ENRICHMENT_STYLES_ORDER } from "../applyByoToAnalysis.js";
import { normalizeEnrichmentOutput, type EnrichmentOutputFormat } from "../output/normalizeEnrichmentOutput.js";
import type { EnrichmentStyle } from "../types.js";

export interface EnrichCommandOptions {
  provider?: string;
  url?: string;
  apiKey?: string;
  model?: string;
  style?: EnrichmentStyle;
  timeout?: number;
  header?: string[];
  systemPromptFile?: string;
  promptFile?: string;
  output?: string;
  format?: EnrichmentOutputFormat;
  temperature?: number;
  maxTokens?: number;
}

export async function runEnrich(inputPath: string, options: EnrichCommandOptions): Promise<void> {
  const providerName = options.provider;
  if (!providerName) {
    throw new SolidError("INVALID_FLAGS", "Missing --provider. Use one of: openai-compatible, noop.", { recoverable: true });
  }
  if (providerName.trim() === "openai-compatible") {
    process.stderr.write(`[solidx] ${BYO_OUTBOUND_LLM_NOTICE}\n\n`);
  }
  const style = options.style ?? "briefing";
  if (!ENRICHMENT_STYLES_ORDER.includes(style)) {
    throw new SolidError("INVALID_FLAGS", `Invalid --style "${style}".`, {
      recoverable: true,
      details: `Use one of: ${ENRICHMENT_STYLES_ORDER.join(", ")}`,
    });
  }

  const analysis = await loadAnalysisJson(inputPath);
  const enrichment = await applyByoEnrichmentToAnalysisResult(
    analysis,
    { ...options, provider: providerName, style },
    inputPath,
  );

  const format = options.format ?? "text";
  const normalized = normalizeEnrichmentOutput(enrichment, format);
  if (options.output) {
    await writeFile(resolve(options.output), normalized, "utf8");
    process.stdout.write(`Wrote enrichment output to ${options.output}\n`);
    return;
  }
  process.stdout.write(`${normalized}\n`);
}
