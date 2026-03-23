import type { AnalysisResult } from "../../contracts/model.js";
import {
  INCIDENT_ENRICHMENT_SCHEMA_VERSION,
  type BuildIncidentPayloadOptions,
  type CorrelationSummary,
  type EvidenceExcerpt,
  type IncidentEnrichmentPayload,
  type IncidentSignal,
  type RootCauseCandidate,
  type TimelineSummaryEntry,
} from "../types.js";
import {
  clampHealthScore,
  clampUnit,
  coerceArray,
  compactObject,
  normalizeBuildOptions,
  trimText,
} from "./sanitizePayload.js";

function limitedUnique(values: string[], maxItems = 12): string[] {
  return [...new Set(values.filter(Boolean))].slice(0, maxItems);
}

function sortByTimestamp(entries: TimelineSummaryEntry[]): TimelineSummaryEntry[] {
  return [...entries].sort((a, b) => {
    const aTs = a.timestamp ?? "";
    const bTs = b.timestamp ?? "";
    return aTs.localeCompare(bTs);
  });
}

function buildCorrelationSummary(analysis: AnalysisResult): CorrelationSummary | undefined {
  const snapshot = analysis.correlationSnapshot;
  if (!snapshot) return undefined;
  const rulesMatched = Object.entries(snapshot.diagnostics.ruleHits)
    .filter(([, count]) => count > 0)
    .map(([ruleId]) => ruleId);
  return compactObject({
    hasSnapshot: true,
    highlights: snapshot.findings
      .slice(0, 6)
      .map((finding) => finding.title)
      .filter(Boolean),
    rulesMatched: rulesMatched.length ? rulesMatched : undefined,
    crossSourcePropagation: snapshot.causalChains.some((chain) => (chain.involvedServices?.length ?? 0) > 1),
    errorBurstServices: limitedUnique(
      snapshot.findings
        .filter((finding) => finding.severity === "error")
        .flatMap((finding) => finding.services ?? []),
      8,
    ),
  });
}

export function buildIncidentEnrichmentPayload(
  analysis: AnalysisResult,
  options?: BuildIncidentPayloadOptions,
): IncidentEnrichmentPayload {
  const limits = normalizeBuildOptions(options);

  const candidateRows: RootCauseCandidate[] = (analysis.assessment.rootCauseCandidates ?? []).map((candidate, index) =>
    compactObject({
      rank: index + 1,
      label: trimText(candidate.label ?? candidate.id, limits.maxStringLength) ?? "unknown",
      confidence: clampUnit(candidate.confidence),
      category: trimText(analysis.assessment.triggerClassification, limits.maxStringLength),
      service: candidate.affectedServices?.[0],
      reasoning: [candidate.evidence].map((entry) => trimText(entry, limits.maxStringLength)).filter(Boolean) as string[],
      evidence: candidate.affectedServices?.slice(0, 4),
    }),
  );
  const rootCauseCandidates = coerceArray(candidateRows, limits.maxCandidates);
  const candidatesDropped = Math.max(0, candidateRows.length - rootCauseCandidates.length);

  const signalRows: IncidentSignal[] = (analysis.signals ?? []).map((signal) =>
    compactObject({
      name: trimText(signal.label, limits.maxStringLength) ?? "unknown",
      category: signal.scoreSource,
      count: signal.count,
      confidence: clampUnit(signal.score ?? signal.mlScore),
      relatedServices: signal.service ? [signal.service] : undefined,
      details: [signal.description].map((entry) => trimText(entry, limits.maxStringLength)).filter(Boolean) as string[],
    }),
  );
  const signals = coerceArray(signalRows, limits.maxSignals);
  const signalsDropped = Math.max(0, signalRows.length - signals.length);

  const timelineRows: TimelineSummaryEntry[] = (analysis.timeline ?? []).map((entry) =>
    compactObject({
      timestamp: entry.timestamp,
      service: trimText(entry.service, limits.maxStringLength),
      normalizedType: entry.isTrigger ? "trigger" : entry.anomaly ? "anomaly" : "event",
      severity: entry.severity,
      message: trimText(entry.message, limits.maxStringLength),
      annotation: entry.isTrigger ? "detected trigger event" : undefined,
    }),
  );
  const timeline = coerceArray(sortByTimestamp(timelineRows), limits.maxTimelineEntries);
  const timelineEntriesDropped = Math.max(0, timelineRows.length - timeline.length);

  const excerptRows: EvidenceExcerpt[] = [
    ...(analysis.timeline ?? []).slice(0, limits.maxExcerpts).map((entry) =>
      compactObject({
        kind: "timeline" as const,
        service: entry.service,
        timestamp: entry.timestamp,
        text: trimText(`${entry.severity}: ${entry.message}`, limits.maxStringLength) ?? "",
      }),
    ),
    ...(analysis.assessment.rootCauseCandidates ?? []).slice(0, 3).map((candidate) =>
      compactObject({
        kind: "candidate" as const,
        service: candidate.affectedServices?.[0],
        text: trimText(`${candidate.label ?? candidate.id}: ${candidate.evidence}`, limits.maxStringLength) ?? "",
      }),
    ),
    ...(analysis.signals ?? []).slice(0, 3).map((signal) =>
      compactObject({
        kind: "signal" as const,
        service: signal.service,
        text: trimText(`${signal.label}${signal.description ? `: ${signal.description}` : ""}`, limits.maxStringLength) ?? "",
      }),
    ),
  ].filter((entry) => entry.text.length > 0);
  const evidenceExcerpts = coerceArray(excerptRows, limits.maxExcerpts);
  const excerptsDropped = Math.max(0, excerptRows.length - evidenceExcerpts.length);

  const confidence = clampUnit(analysis.summary.confidence);
  const healthScore = clampHealthScore(analysis.assessment.healthScore);

  const trigger = compactObject({
    timestamp: analysis.assessment.triggerTimestamp,
    service: trimText(analysis.assessment.triggerService, limits.maxStringLength),
    normalizedType: trimText(analysis.assessment.triggerClassification, limits.maxStringLength),
    severity: analysis.assessment.severity,
    message: trimText(analysis.summary.triggerEvent, limits.maxStringLength),
    evidence: rootCauseCandidates[0]?.evidence?.slice(0, 3),
  });

  return {
    schemaVersion: INCIDENT_ENRICHMENT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: compactObject({
      kind: "analysis-result" as const,
      engine: "solid-incident-cli",
      engineVersion: trimText(analysis.schema?.schemaVersion, limits.maxStringLength),
      analysisMode: analysis.mode,
    }),
    incident: compactObject({
      title: trimText(analysis.summary.triggerEvent, limits.maxStringLength),
      summary: trimText(analysis.summary.incidentSummary, limits.maxStringLength),
      verdict: analysis.assessment.verdict,
      severity: analysis.assessment.severity,
      confidence,
      healthScore,
    }),
    trigger: Object.keys(trigger).length ? trigger : undefined,
    rootCauseCandidates,
    affectedServices: limitedUnique([
      ...(analysis.summary.affectedServices ?? []),
      ...(analysis.traceGraph?.nodes ?? []),
    ]),
    signals,
    propagation: compactObject({
      chain: coerceArray(analysis.assessment.propagationChain ?? [], 12),
      edgeCount: analysis.traceGraph?.edges?.length,
      confidence:
        analysis.traceGraph?.edges?.length
          ? clampUnit(
              analysis.traceGraph.edges.reduce((sum, edge) => sum + edge.confidence, 0) /
                Math.max(1, analysis.traceGraph.edges.length),
            )
          : undefined,
      notes: (analysis.traceGraph?.edges ?? [])
        .slice(0, 6)
        .map((edge) => trimText(`${edge.from} -> ${edge.to}: ${edge.annotation}`, limits.maxStringLength))
        .filter((entry): entry is string => Boolean(entry)),
    }),
    timeline,
    trust: compactObject({
      overall: confidence,
      parseCoverage: clampUnit(analysis.diagnostics.parseCoverage),
      timestampCoverage: clampUnit(analysis.diagnostics.timestampCoverage),
      serviceCoverage: clampUnit(analysis.diagnostics.serviceCoverage),
      severityCoverage: clampUnit(analysis.diagnostics.severityCoverage),
      evidenceDensity: clampUnit(analysis.diagnostics.evidenceDensity),
      ambiguityFlags: analysis.diagnostics.ambiguityFlags ?? [],
      notes: (analysis.diagnostics.warnings ?? [])
        .slice(0, 8)
        .map((entry) => trimText(entry, limits.maxStringLength))
        .filter((entry): entry is string => Boolean(entry)),
    }),
    suggestedCauses: coerceArray(
      (analysis.assessment.suggestedCauses ?? []).map((entry) => trimText(entry, limits.maxStringLength)).filter(Boolean) as string[],
      12,
    ),
    suggestedFixes: coerceArray(
      (analysis.assessment.suggestedFixes ?? []).map((entry) => trimText(entry, limits.maxStringLength)).filter(Boolean) as string[],
      12,
    ),
    correlation: buildCorrelationSummary(analysis),
    evidenceExcerpts,
    metadata: {
      analysisId: trimText(`${analysis.metadata.createdAt}-${analysis.metadata.rawLineCount}`, limits.maxStringLength),
      inputLabel: trimText(limits.inputLabel || undefined, limits.maxStringLength),
      verdict: analysis.assessment.verdict,
      severity: analysis.assessment.severity,
      confidence,
      healthScore,
      ambiguityFlags: analysis.diagnostics.ambiguityFlags ?? [],
      truncation: {
        timelineEntriesDropped,
        signalsDropped,
        candidatesDropped,
        excerptsDropped,
      },
    },
  };
}

