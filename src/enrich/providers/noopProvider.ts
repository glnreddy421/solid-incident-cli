import type {
  EnrichmentProvider,
  EnrichmentRequest,
  EnrichmentResult,
} from "../types.js";

export class NoopProvider implements EnrichmentProvider {
  readonly name = "noop" as const;

  async enrich(request: EnrichmentRequest): Promise<EnrichmentResult> {
    const metadata = request.payload.incident;
    const text = [
      `NOOP enrichment (${request.style})`,
      `Verdict: ${metadata.verdict}`,
      `Severity: ${metadata.severity}`,
      "This provider is for local testing only and performs no model inference.",
    ].join("\n");

    return {
      provider: { provider: this.name, model: "noop" },
      style: request.style,
      schemaVersion: request.payload.schemaVersion,
      generatedAt: new Date().toISOString(),
      content: `## NOOP Enrichment\n\n${text.replaceAll("\n", "  \n")}`,
      format: "markdown",
      sections: [{ title: "NOOP", body: text }],
    };
  }
}
