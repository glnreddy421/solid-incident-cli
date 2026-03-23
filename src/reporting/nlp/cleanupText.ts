import { applyGrammarRules } from "./grammarRules.js";
import { dedupeAdjacentPhrases } from "./dedupePhrases.js";
import { smoothMarkdownBlocks } from "./sentenceSmoother.js";

function normalizeWhitespace(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Deterministic polish pipeline for assembled markdown reports.
 */
export function polishReportMarkdown(raw: string): string {
  let t = normalizeWhitespace(raw);
  t = dedupeAdjacentPhrases(t);
  t = applyGrammarRules(t);
  t = smoothMarkdownBlocks(t);
  t = normalizeWhitespace(t);
  return t;
}
