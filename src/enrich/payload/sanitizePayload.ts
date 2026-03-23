import type { BuildIncidentPayloadOptions } from "../types.js";

const DEFAULT_MAX_STRING_LENGTH = 400;

export function clampUnit(value: number | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  if (value > 1) return Math.max(0, Math.min(1, value / 100));
  return Math.max(0, Math.min(1, value));
}

export function clampHealthScore(value: number | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(100, value));
}

export function trimText(value: string | undefined, maxLen = DEFAULT_MAX_STRING_LENGTH): string | undefined {
  if (value == null) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen)}...`;
}

export function coerceArray<T>(value: T[] | undefined, maxLen: number): T[] {
  return Array.isArray(value) ? value.slice(0, Math.max(0, maxLen)) : [];
}

export function compactObject<T extends object>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (nested == null) continue;
    if (typeof nested === "string" && nested.trim().length === 0) continue;
    if (Array.isArray(nested) && nested.length === 0) continue;
    if (typeof nested === "object" && !Array.isArray(nested) && Object.keys(nested as object).length === 0) continue;
    out[key] = nested;
  }
  return out as T;
}

function stableJsonStringify(value: unknown): string {
  const sortDeep = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(sortDeep);
    if (!entry || typeof entry !== "object") return entry;
    const record = entry as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = sortDeep(record[key]);
    }
    return out;
  };
  return JSON.stringify(sortDeep(value), null, 2);
}

export function safeSerializePayload(payload: unknown): string {
  return stableJsonStringify(payload);
}

export function normalizeBuildOptions(options: BuildIncidentPayloadOptions | undefined): Required<BuildIncidentPayloadOptions> {
  return {
    maxTimelineEntries: options?.maxTimelineEntries ?? 40,
    maxSignals: options?.maxSignals ?? 20,
    maxCandidates: options?.maxCandidates ?? 5,
    maxExcerpts: options?.maxExcerpts ?? 8,
    maxStringLength: options?.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH,
    inputLabel: options?.inputLabel ?? "",
  };
}
