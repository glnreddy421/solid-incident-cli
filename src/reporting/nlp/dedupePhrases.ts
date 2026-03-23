/**
 * Remove immediately repeated multi-word spans (deterministic).
 */
export function dedupeAdjacentPhrases(text: string): string {
  const lines = text.split("\n");
  return lines
    .map((line) => {
      let s = line.replace(/\s+/g, " ").trim();
      // Collapse same 3+ word phrase twice in a row
      for (let pass = 0; pass < 3; pass++) {
        const m = s.match(/^(.{10,}?)\s+\1(\s|$|[.,])/i);
        if (m) {
          s = s.slice(0, m.index! + m[1].length) + s.slice(m.index! + m[1].length * 2 + 1);
        } else break;
      }
      // "likely cause is likely cause is" style
      s = s.replace(/\b(\w+(?:\s+\w+){2,8})\s+\1\b/gi, "$1");
      return s;
    })
    .join("\n");
}
