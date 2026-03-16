import { harAdapter } from "./harAdapter.js";
import { pcapAdapter } from "./pcapAdapter.js";
import { textLogAdapter } from "./textLogAdapter.js";
import type { AdapterCandidate, AdapterIngestResult, AdapterInput, AdapterMatchResult, InputAdapter } from "./types.js";

interface RegistryMetrics {
  adapterHits: Record<string, number>;
  unsupportedHits: number;
  warnings: number;
  ambiguousSelections: number;
}

const metrics: RegistryMetrics = {
  adapterHits: {},
  unsupportedHits: 0,
  warnings: 0,
  ambiguousSelections: 0,
};

const adapters: InputAdapter[] = [harAdapter, pcapAdapter, textLogAdapter];

function markAdapterHit(adapterId: string): void {
  metrics.adapterHits[adapterId] = (metrics.adapterHits[adapterId] ?? 0) + 1;
}

export function registerAdapter(adapter: InputAdapter): void {
  adapters.push(adapter);
}

export function getAdapterRegistrySnapshot(): string[] {
  return adapters.map((adapter) => adapter.adapterId);
}

export function resetAdapterRegistryForTests(): void {
  adapters.length = 0;
  adapters.push(harAdapter, pcapAdapter, textLogAdapter);
  metrics.adapterHits = {};
  metrics.unsupportedHits = 0;
  metrics.warnings = 0;
  metrics.ambiguousSelections = 0;
}

export function getAdapterMetrics(): RegistryMetrics {
  return {
    adapterHits: { ...metrics.adapterHits },
    unsupportedHits: metrics.unsupportedHits,
    warnings: metrics.warnings,
    ambiguousSelections: metrics.ambiguousSelections,
  };
}

export interface AdapterSelection {
  adapter: InputAdapter | null;
  selectedMatch?: AdapterMatchResult;
  candidates: AdapterCandidate[];
}

export function selectAdapter(input: AdapterInput): AdapterSelection {
  const candidatesWithMatch = adapters
    .map((adapter) => ({ adapter, match: adapter.canHandle(input) }))
    .filter((entry) => entry.match.matched && !entry.match.hardReject);

  const candidates: AdapterCandidate[] = candidatesWithMatch.map((entry) => ({
    adapterId: entry.adapter.adapterId,
    confidence: entry.match.confidence,
    reasons: entry.match.reasons,
  }));

  if (candidatesWithMatch.length === 0) {
    return { adapter: null, candidates };
  }
  if (candidatesWithMatch.filter((entry) => entry.match.confidence >= 0.8).length > 1) {
    metrics.ambiguousSelections += 1;
  }

  // Deterministic by explicit adapter registration order.
  const selected = candidatesWithMatch[0];
  return { adapter: selected.adapter, selectedMatch: selected.match, candidates };
}

export function ingestWithAdapters(input: AdapterInput): AdapterIngestResult {
  const selection = selectAdapter(input);
  if (!selection.adapter || !selection.selectedMatch) {
    metrics.unsupportedHits += 1;
    return {
      adapterId: "unsupported",
      adapterConfidence: 0,
      adapterReasons: ["no adapter matched input strongly"],
      candidateAdapters: selection.candidates,
      kind: "unsupported",
      events: [],
      warnings: ["Input type is currently unsupported by adapter registry."],
    };
  }
  const result = selection.adapter.ingest(input, selection.selectedMatch, selection.candidates);
  markAdapterHit(selection.adapter.adapterId);
  if (result.warnings?.length) metrics.warnings += result.warnings.length;
  if (result.adapterWarnings?.length) metrics.warnings += result.adapterWarnings.length;
  return result;
}

