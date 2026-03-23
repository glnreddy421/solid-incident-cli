import { describe, expect, it } from "vitest";
import { normalizeEnrichmentOutput, normalizeEnrichmentResult } from "../../src/enrich/output/normalizeEnrichmentOutput.js";
import type { EnrichmentResult } from "../../src/enrich/types.js";

describe("normalizeEnrichmentResult", () => {
  it("normalizes content/sections consistently", () => {
    const result: EnrichmentResult = {
      style: "rca",
      schemaVersion: "incident-enrichment.v1",
      generatedAt: new Date().toISOString(),
      provider: { provider: "noop" },
      content: "  hello world  ",
      format: "text",
      sections: [{ title: " Summary ", body: " body " }, { title: "", body: "" }],
    };
    const normalized = normalizeEnrichmentResult(result);
    expect(normalized.content).toBe("hello world");
    expect(normalized.sections?.length).toBe(1);
  });

  it("renders json/text/markdown outputs from normalized contract", () => {
    const result: EnrichmentResult = {
      style: "executive",
      schemaVersion: "incident-enrichment.v1",
      generatedAt: new Date().toISOString(),
      provider: { provider: "noop" },
      content: "incident output",
      format: "markdown",
      sections: [{ title: "Summary", body: "incident output" }],
    };
    expect(() => JSON.parse(normalizeEnrichmentOutput(result, "json"))).not.toThrow();
    expect(normalizeEnrichmentOutput(result, "text")).toContain("Summary");
    expect(normalizeEnrichmentOutput(result, "markdown")).toContain("incident output");
  });
});
