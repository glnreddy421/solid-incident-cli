import { describe, expect, it } from "vitest";
import { applyGrammarRules } from "../../src/reporting/nlp/grammarRules.js";
import { dedupeAdjacentPhrases } from "../../src/reporting/nlp/dedupePhrases.js";
import { polishReportMarkdown } from "../../src/reporting/nlp/cleanupText.js";

describe("reporting NLP cleanup", () => {
  it("applyGrammarRules fixes incident triggered pattern without breaking timestamps", () => {
    expect(applyGrammarRules("The incident triggered by failures")).toContain("was triggered by");
    const iso = "Window: 2024-03-08T14:02:12Z → 2024-03-08T14:02:14Z.";
    expect(applyGrammarRules(iso)).toBe(iso);
  });

  it("dedupeAdjacentPhrases collapses repeated short phrases", () => {
    expect(dedupeAdjacentPhrases("likely cause is likely cause is X")).toContain("likely cause is X");
  });

  it("polishReportMarkdown preserves ISO timestamps in a block", () => {
    const md = `# Title\n\nAt **2024-03-08T14:02:12Z**, **api** logged an error.\n\n> **Note:** ok.\n`;
    const out = polishReportMarkdown(md);
    expect(out).toContain("2024-03-08T14:02:12Z");
  });
});
