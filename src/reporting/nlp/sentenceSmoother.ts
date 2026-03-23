/**
 * Light prose-only smoothing. Skips markdown structural lines.
 */
export function smoothMarkdownBlocks(md: string): string {
  return md
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t || t.startsWith("#") || t.startsWith("|") || t.startsWith("```") || /^[-*]\s/.test(t) || /^\d+\.\s/.test(t)) {
        return line;
      }
      let x = t;
      const looksLikeBoldLabel = /^\*\*[^*]+\*\*:?\s*$/.test(x) || /\*\*\s*$/.test(x);
      const endsWithClauseBreak = /[:)]$/.test(x);
      if (
        x.length > 35 &&
        !/[.!?…]$/.test(x) &&
        !x.includes("|") &&
        !looksLikeBoldLabel &&
        !endsWithClauseBreak
      ) {
        x = `${x}.`;
      }
      return line.startsWith(">") ? `> ${x.replace(/^>\s*/, "")}` : x;
    })
    .join("\n");
}
