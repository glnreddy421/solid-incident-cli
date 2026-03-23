export function formatServiceList(services: string[]): string {
  if (!services.length) return "—";
  const uniq = [...new Set(services.map((s) => s.trim()).filter(Boolean))];
  return uniq.join(", ");
}
