import type { EnrichmentResult } from "../types.js";

export type EnrichmentOutputFormat = "json" | "markdown" | "text";

export function normalizeEnrichmentResult(result: EnrichmentResult): EnrichmentResult {
  return {
    ...result,
    content: result.content.trim(),
    generatedAt: result.generatedAt || new Date().toISOString(),
    sections: result.sections?.filter((section) => section.title.trim() && section.body.trim()),
  };
}

export function normalizeEnrichmentOutput(result: EnrichmentResult, format: EnrichmentOutputFormat): string {
  const normalized = normalizeEnrichmentResult(result);
  if (format === "json") {
    return JSON.stringify(
      {
        metadata: {
          schemaVersion: normalized.schemaVersion,
          generatedAt: normalized.generatedAt,
          format: normalized.format,
          sections: normalized.sections ?? [],
        },
        content: normalized.content,
        style: normalized.style,
        provider: normalized.provider,
      },
      null,
      2,
    );
  }

  if (format === "markdown") {
    if (normalized.format === "markdown") return normalized.content;
    if (normalized.sections?.length) {
      return normalized.sections.map((section) => `## ${section.title}\n\n${section.body}`).join("\n\n");
    }
    return normalized.content;
  }

  if (normalized.sections?.length) {
    return normalized.sections.map((section) => `${section.title}\n${"-".repeat(section.title.length)}\n${section.body}`).join("\n\n");
  }
  return normalized.content;
}
