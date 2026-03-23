/** Bullet list from string lines; trims empties */
export function formatEvidenceBullets(lines: string[], max = 24): string {
  const out = lines.map((l) => l.trim()).filter(Boolean).slice(0, max);
  if (!out.length) return "—";
  return out.map((l) => `- ${l}`).join("\n");
}
