/**
 * ML enrichment for the SOLID engine.
 * Uses K-means clustering and distance-based anomaly scoring to enhance
 * heuristic signals and trace graph with model-driven confidence.
 */

import { kmeans } from "ml-kmeans";
import { distance } from "ml-distance";
import type { TimelineEntry } from "../contracts/index.js";

const SEVERITY_WEIGHT: Record<string, number> = {
  debug: 0,
  info: 0.2,
  warning: 0.5,
  warn: 0.5,
  error: 0.8,
  critical: 1,
};

const ANOMALY_KEYWORDS = [
  /error|failed|refused|timeout|exception|crash|panic|oom/i,
  /retry|attempt \d+|back-off|backoff/i,
  /connection refused|pool exhausted|deadline exceeded/i,
];

function extractFeatures(entry: TimelineEntry): number[] {
  const severity = SEVERITY_WEIGHT[entry.severity] ?? 0.3;
  const msgLen = Math.min(1, (entry.message?.length ?? 0) / 200);
  const anomalyFlag = entry.anomaly ? 1 : 0;
  const keywordFlags = ANOMALY_KEYWORDS.map((re) => (re.test(entry.message ?? "") ? 1 : 0));
  return [severity, msgLen, anomalyFlag, ...keywordFlags];
}

export interface MlEnrichmentResult {
  /** Per-event anomaly score 0–1 (higher = more anomalous) */
  eventScores: number[];
  /** Cluster assignment per event (0 = normal-ish, 1 = anomaly-ish) */
  clusters: number[];
  /** Model type for provenance */
  modelType: string;
  /** Whether ML ran successfully */
  available: boolean;
}

const MODEL_TYPE = "kmeans-anomaly-v1";

/**
 * Run ML-based anomaly scoring on timeline events.
 * Uses K-means (k=2) to separate normal vs anomalous patterns, then
 * computes distance-from-centroid as anomaly score.
 */
export function runMlEnrichment(timeline: TimelineEntry[]): MlEnrichmentResult {
  const eventScores: number[] = [];
  const clusters: number[] = [];

  if (timeline.length < 2) {
    return {
      eventScores: timeline.map((e) => (e.anomaly ? 0.7 : 0.3)),
      clusters: timeline.map((e) => (e.anomaly ? 1 : 0)),
      modelType: MODEL_TYPE,
      available: false,
    };
  }

  try {
    const features = timeline.map(extractFeatures);
    const k = Math.min(2, Math.max(1, Math.floor(timeline.length / 5)));
    const result = kmeans(features, k, { maxIterations: 50 });

    const centroids = result.centroids as number[][];
    const clusterAssignments = result.clusters as number[];

    for (let i = 0; i < timeline.length; i++) {
      const clusterIdx = clusterAssignments[i];
      const centroid = centroids[clusterIdx];
      const feat = features[i];
      const dist = distance.euclidean(feat, centroid);

      const maxDist = Math.max(
        ...features.map((f) => distance.euclidean(f, centroid))
      );
      const normalizedDist = maxDist > 0 ? Math.min(1, dist / (maxDist * 1.5)) : 0;

      const anomalyCluster = centroids.reduce((best, c, idx) => {
        const meanSev = c[0];
        return meanSev > best.meanSev ? { idx, meanSev } : best;
      }, { idx: 0, meanSev: 0 });

      const isAnomalyCluster = clusterIdx === anomalyCluster.idx;
      const score = isAnomalyCluster
        ? 0.5 + normalizedDist * 0.5
        : 0.5 - normalizedDist * 0.3;
      eventScores.push(Math.max(0, Math.min(1, score)));
      clusters.push(clusterIdx);
    }

    return {
      eventScores,
      clusters,
      modelType: MODEL_TYPE,
      available: true,
    };
  } catch {
    return {
      eventScores: timeline.map((e) => (e.anomaly ? 0.7 : 0.3)),
      clusters: timeline.map((e) => (e.anomaly ? 1 : 0)),
      modelType: MODEL_TYPE,
      available: false,
    };
  }
}

/**
 * Blend heuristic score with ML anomaly score.
 * @param heuristic 0–1 from pattern matching
 * @param mlScore 0–1 from ML model
 * @param mlWeight 0–1 weight for ML (default 0.4)
 */
export function blendScores(
  heuristic: number,
  mlScore: number,
  mlWeight = 0.4
): number {
  return heuristic * (1 - mlWeight) + mlScore * mlWeight;
}
