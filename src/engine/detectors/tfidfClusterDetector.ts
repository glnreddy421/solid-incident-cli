/**
 * TF-IDF + clustering for dynamic pattern detection.
 * Finds patterns that emerge from the data without pre-defined rules.
 */

import { kmeans } from "ml-kmeans";
import type { ParsedIncidentEvent, Signal } from "../../contracts/index.js";

const STOPWORDS = new Set([
  "the", "a", "an", "is", "at", "which", "on", "to", "of", "in", "for",
  "and", "or", "but", "it", "its", "as", "by", "with", "from", "be", "was",
  "are", "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "must", "can", "this", "that",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/["{}[\]:,]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^\W+|\W+$/g, ""))
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

function buildVocabulary(docs: string[][]): string[] {
  const seen = new Set<string>();
  for (const tokens of docs) {
    for (const t of tokens) seen.add(t);
  }
  return [...seen];
}

function computeTfIdf(
  docs: string[][],
  vocabulary: string[]
): number[][] {
  const N = docs.length;
  const vocabIdx = new Map(vocabulary.map((t, i) => [t, i]));
  const df = new Array(vocabulary.length).fill(0);

  for (const tokens of docs) {
    const unique = new Set(tokens);
    for (const t of unique) {
      const i = vocabIdx.get(t);
      if (i != null) df[i]++;
    }
  }

  const vectors: number[][] = [];
  for (const tokens of docs) {
    const tf = new Array(vocabulary.length).fill(0);
    for (const t of tokens) {
      const i = vocabIdx.get(t);
      if (i != null) tf[i]++;
    }
    const maxTf = Math.max(1, ...tf);
    const vec = tf.map((count, i) => {
      const tfVal = count / maxTf;
      const idf = Math.log((N + 1) / (df[i] + 1)) + 1;
      return tfVal * idf;
    });
    vectors.push(vec);
  }
  return vectors;
}

function topTermsInCluster(
  eventIndices: number[],
  events: ParsedIncidentEvent[],
  vocabulary: string[],
  vectors: number[][],
  topK = 5
): string[] {
  const termScores = new Map<string, number>();
  for (const idx of eventIndices) {
    const vec = vectors[idx];
    const msg = events[idx]?.message ?? "";
    const tokens = tokenize(msg);
    for (let i = 0; i < vec.length; i++) {
      if (vec[i] > 0) {
        const term = vocabulary[i];
        termScores.set(term, (termScores.get(term) ?? 0) + vec[i]);
      }
    }
  }
  return [...termScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([t]) => t);
}

function inferSeverityFromEvents(events: ParsedIncidentEvent[], indices: number[]): Signal["severity"] {
  const sevs = indices.map((i) => events[i]?.severity).filter(Boolean) as string[];
  if (sevs.some((s) => s === "critical")) return "critical";
  if (sevs.some((s) => s === "error")) return "error";
  if (sevs.some((s) => s === "warning" || s === "warn")) return "warning";
  return "info";
}

/**
 * Detect dynamic patterns via TF-IDF + K-means clustering.
 * Small clusters (rare message patterns) become signals.
 */
export function detectTfidfClusterSignals(events: ParsedIncidentEvent[]): Signal[] {
  const signals: Signal[] = [];
  if (events.length < 4) return signals;

  const docs = events.map((e) => `${e.message} ${e.service}`.trim());
  const tokenized = docs.map(tokenize);
  const vocabulary = buildVocabulary(tokenized);
  if (vocabulary.length < 3) return signals;

  const vectors = computeTfIdf(tokenized, vocabulary);
  const k = Math.min(8, Math.max(2, Math.floor(Math.sqrt(events.length / 2))));

  try {
    const result = kmeans(vectors, k, { maxIterations: 30 });
    const clusters = result.clusters as number[];
    const clusterMembers = new Map<number, number[]>();
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      const arr = clusterMembers.get(c) ?? [];
      arr.push(i);
      clusterMembers.set(c, arr);
    }

    const total = events.length;
    const smallClusterThreshold = Math.max(2, Math.floor(total * 0.15));

    for (const [clusterId, indices] of clusterMembers) {
      if (indices.length > smallClusterThreshold) continue;
      if (indices.length < 2) continue;

      const terms = topTermsInCluster(indices, events, vocabulary, vectors, 4);
      if (terms.length === 0) continue;

      const label = `tfidf_cluster_${terms.slice(0, 2).join("_")}`.replace(/\s+/g, "_");
      const severity = inferSeverityFromEvents(events, indices);
      const services = [...new Set(indices.map((i) => events[i]?.service).filter(Boolean))];
      const primaryService = services[0] ?? "unknown";

      signals.push({
        label: terms.join(", "),
        description: `TF-IDF cluster (${indices.length} events). Terms: ${terms.join(", ")}`,
        severity,
        count: indices.length,
        service: primaryService,
        score: Math.min(10, 2 + indices.length),
        mlScore: 1 - indices.length / total,
        scoreSource: "tfidf",
        supportingEventIndexes: [...indices],
      });
    }
  } catch {
    // Clustering failed; skip dynamic signals
  }

  return signals;
}
