/**
 * Narrow, deterministic substitutions. Order matters — conservative patterns only.
 * Avoid broad colon/whitespace rules: they break ISO timestamps, markdown `**bold:**`, and block layout.
 */
export function applyGrammarRules(text: string): string {
  let t = text;

  t = t.replace(/,{2,}/g, ",");
  t = t.replace(/\.{3,}/g, "…");

  // Common template glitches
  t = t.replace(/\bThe incident triggered by\b/gi, "The incident was triggered by");
  t = t.replace(/\bincident triggered by\b/gi, "incident was triggered by");
  t = t.replace(/\bMost likely root cause ([a-z0-9_.-]+)\s+unavailable\b/gi, "The most likely root cause is **$1** unavailability.");
  t = t.replace(/\bMost likely root cause is is\b/gi, "Most likely root cause is");
  t = t.replace(/\bwas was\b/gi, "was");

  // Double articles
  t = t.replace(/\bthe the\b/gi, "the");
  t = t.replace(/\ba a\b/gi, "a");

  return t;
}
