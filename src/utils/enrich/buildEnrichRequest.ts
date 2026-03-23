/**
 * Assembles grounded EnrichRequest v2 from heuristic AnalysisResult (+ optional correlation).
 */

import { randomUUID } from "crypto";
import type { AnalysisResult } from "../../contracts/model.js";
import type {
  EnrichCausalChain,
  EnrichEvidence,
  EnrichFinding,
  EnrichImpactScope,
  EnrichLayering,
  EnrichMetadata,
  EnrichRecommendedCheckInput,
  EnrichRequest,
  EnrichRootCauseCandidate,
  EnrichRuleDiagnostic,
  EnrichSourceSummary,
  FindingClassification,
  FindingKind,
} from "../../contracts/enrich.js";
import type { CausalChain, CorrelationResult, Finding } from "../../core/correlation/types.js";

const MAX_EVIDENCE_ITEMS = 80;
const MAX_RAW_EXCERPT = 200;

function trimExcerpt(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= MAX_RAW_EXCERPT ? t : `${t.slice(0, MAX_RAW_EXCERPT)}…`;
}

function findingClassificationFromCorrelation(f: Finding): FindingClassification {
  if (f.strength === "high-confidence-cross-source") return "strongly_corroborated";
  if (f.corroboration === "multi-source-corroborated") return "corroborated";
  return "inferred";
}

function mapCorrelationFinding(f: Finding, idx: number): EnrichFinding {
  const refs = (f.evidenceRefs ?? f.evidence ?? []).map((e) => e.eventId).filter(Boolean);
  return {
    findingId: f.findingId ?? f.id ?? `finding-${idx}`,
    title: f.title,
    kind: "correlation",
    severity: f.severity,
    confidence: f.overallConfidence ?? f.confidence,
    classification: findingClassificationFromCorrelation(f),
    ruleId: f.ruleId,
    ruleName: f.ruleName,
    summary: f.description ?? f.summary,
    evidenceRefs: refs,
    reasons: f.reasons ?? [],
    warnings: f.warnings,
  };
}

function mapCausalChain(c: CausalChain, idx: number): EnrichCausalChain {
  const steps = (c.orderedSteps ?? c.steps ?? []).map((s) => s.description ?? s.label);
  const refs = (c.evidenceRefs ?? []).map((e) => e.eventId).filter(Boolean);
  return {
    chainId: c.chainId ?? c.id ?? `chain-${idx}`,
    title: c.reasons?.[0] ?? `Causal chain ${idx + 1}`,
    classification: `${c.strength} / ${c.corroboration}`,
    overallConfidence: c.overallConfidence ?? c.confidence,
    probableTrigger: c.probableTrigger?.eventId ?? c.probableTrigger?.explanation,
    orderedSteps: steps,
    involvedServices: c.involvedServices ?? [],
    evidenceRefs: refs,
    warnings: c.warnings,
  };
}

function signalsToFindings(result: AnalysisResult): EnrichFinding[] {
  const signals = Array.isArray(result.signals) ? result.signals : [];
  if (signals.length === 0) {
    return [
      {
        findingId: "finding-sparse-input",
        title: "No discrete heuristic signals",
        kind: "other" as FindingKind,
        severity: "info",
        confidence: 0.35,
        classification: "inferred" as FindingClassification,
        ruleId: "sparse-input",
        ruleName: "Signal detector",
        summary: "Engine did not emit strong signals; rely on timeline and assessment.",
        evidenceRefs: (result.timeline ?? []).slice(0, 3).map((t) => t.id),
        reasons: ["empty_or_weak_signal_set"],
      },
    ];
  }
  return signals.map((s, i) => ({
    findingId: `signal-${i}`,
    title: s.label,
    kind: "signal" as FindingKind,
    severity: s.severity,
    confidence: Math.min(1, (s.score ?? s.count ?? 1) / 10),
    classification: "inferred" as FindingClassification,
    ruleId: s.scoreSource === "ml" ? "ml-cluster" : s.scoreSource === "tfidf" ? "tfidf-cluster" : "rule-signal",
    ruleName: s.scoreSource === "ml" ? "ML anomaly cluster" : s.scoreSource === "tfidf" ? "TF-IDF cluster" : "Rule-based signal",
    summary: s.description ?? s.label,
    evidenceRefs: result.timeline.filter((t) => t.service === s.service || t.message.toLowerCase().includes(s.label.toLowerCase().split(" ")[0] ?? "")).slice(0, 5).map((t) => t.id),
    reasons: [s.service ? `service=${s.service}` : "cross-service signal"],
  }));
}

function buildMissingEvidence(result: AnalysisResult): string[] {
  const out: string[] = [];
  const d = result.diagnostics ?? { warnings: [] as string[], errors: [] as string[] };
  if (d.parseCoverage != null && d.parseCoverage < 70) {
    out.push(`Low parse coverage (${Math.round(d.parseCoverage)}%); many lines may be unstructured or unparsed.`);
  }
  if (d.timestampCoverage != null && d.timestampCoverage < 70) {
    out.push(`Weak timestamp coverage (${Math.round(d.timestampCoverage)}%); temporal ordering may be uncertain.`);
  }
  if (d.serviceCoverage != null && d.serviceCoverage < 70) {
    out.push(`Weak service attribution (${Math.round(d.serviceCoverage)}%); service graph may be incomplete.`);
  }
  if (d.ambiguityFlags?.length) {
    out.push(...d.ambiguityFlags.map((a) => `Ambiguity: ${a}`));
  }
  const tl = result.timeline ?? [];
  if (tl.length === 0) {
    out.push("No timeline events after parsing; input may be empty or wholly unparsed.");
  }
  const servicesInTimeline = new Set(tl.map((t) => t.service).filter(Boolean));
  const suspected = new Set<string>();
  const edges = result.traceGraph?.edges ?? [];
  for (const e of edges) {
    suspected.add(e.from);
    suspected.add(e.to);
  }
  for (const t of result.traceGraph?.triggerCandidates ?? []) {
    suspected.add(t.service);
  }
  for (const svc of suspected) {
    if (svc && svc !== "unknown-service" && !servicesInTimeline.has(svc)) {
      out.push(`No log lines attributed to suspected service "${svc}" in this input.`);
    }
  }
  if (!result.correlationSnapshot && (result.inputSources?.length ?? 0) === 1) {
    out.push("Single input source only; cross-source corroboration (e.g. mesh + app logs) not available.");
  }
  out.push("No Kubernetes events, metrics, or network captures were provided in this payload.");
  return out;
}

function buildRuleDiagnostics(result: AnalysisResult, corr?: CorrelationResult): EnrichRuleDiagnostic[] {
  const rows: EnrichRuleDiagnostic[] = [];
  if (corr?.diagnostics) {
    const { ruleHits, ruleExecutionOrder, findingsByRule, chainsByRule } = corr.diagnostics;
    for (const ruleId of ruleExecutionOrder ?? []) {
      const hits = ruleHits[ruleId] ?? 0;
      rows.push({
        ruleId,
        ruleName: ruleId,
        matched: hits > 0,
        reasons: hits > 0 ? [`${hits} finding/chain outputs`] : ["No match in window"],
        evidenceRefs: [
          ...(findingsByRule[ruleId] ?? []),
          ...(chainsByRule[ruleId] ?? []),
        ],
      });
    }
  }
  if (result.diagnostics?.scoreBreakdowns?.length) {
    for (const sb of result.diagnostics.scoreBreakdowns) {
      rows.push({
        ruleId: `root-cause-ranker`,
        ruleName: "Root cause ranker",
        matched: true,
        reasons: [`weightedScore=${sb.weightedScore.toFixed(2)}`, `candidate=${sb.candidateId}`],
        confidenceAdjustment: sb.weightedScore,
        evidenceRefs: [sb.candidateId],
      });
    }
  }
  if (rows.length === 0) {
    rows.push({
      ruleId: "heuristic-engine",
      ruleName: "Local heuristic pipeline",
      matched: true,
      reasons: ["Timeline, signals, propagation, and ranking applied."],
    });
  }
  return rows;
}

export interface BuildEnrichRequestOptions {
  mode?: "batch" | "live";
  incidentId?: string;
}

function minimalEnrichRequestFromResult(
  result: AnalysisResult,
  options: BuildEnrichRequestOptions | undefined,
  assemblyNote: string,
): EnrichRequest {
  const schema = result.schema;
  const mode = options?.mode ?? "batch";
  const incidentId = options?.incidentId ?? randomUUID();
  const summary = schema?.summary ?? result.summary;
  const assessment = schema?.assessment ?? result.assessment;
  const timeline = schema?.timeline?.length ? schema.timeline : result.timeline ?? [];
  const flow = schema?.flow ?? result.flow ?? [];
  const traceGraph = schema?.traceGraph ?? result.traceGraph ?? { nodes: [] as string[], edges: [], triggerCandidates: [] };
  const signals = schema?.signals ?? result.signals ?? [];
  const window = result.analysisWindow ?? {
    start: summary?.incidentWindow?.start ?? "unknown",
    end: summary?.incidentWindow?.end ?? "unknown",
    durationSeconds: 0,
  };

  const legacySchema = schema ?? {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    timeline,
    flow,
    traceGraph,
    assessment,
    signals,
    summary,
  };

  return {
    enrichVersion: "2.0",
    metadata: {
      enrichVersion: "2.0",
      schemaVersion: legacySchema.schemaVersion,
      incidentId,
      generatedAt: legacySchema.generatedAt,
      mode,
      analysisWindow: { start: window.start, end: window.end, durationSeconds: window.durationSeconds },
    },
    impactScope: {
      affectedServices: [...new Set(summary?.affectedServices ?? [])],
      suspectedDependencies: [],
      severity: assessment?.severity ?? "unknown",
      blastRadius: "unknown",
    },
    sourceSummary: {
      sourceCount: result.inputSources?.length ?? 0,
      sourceTypes: [...new Set((result.inputSources ?? []).map((s) => s.kind))],
      sourceIds: (result.inputSources ?? []).map((s) => s.name),
      missingExpectedSources: ["payload:minimal_fallback"],
    },
    findings: [
      {
        findingId: "assembly-fallback",
        title: "Enrich payload assembly used minimal fallback",
        kind: "other",
        severity: "warning",
        confidence: 1,
        classification: "inferred",
        ruleId: "client-assembly",
        summary: assemblyNote,
        evidenceRefs: [],
        reasons: [assemblyNote],
      },
    ],
    causalChains: [
      {
        chainId: "minimal",
        title: "Insufficient structure for causal chain",
        classification: "fallback",
        overallConfidence: 0.2,
        orderedSteps: ["See timeline and assessment only."],
        involvedServices: summary?.affectedServices ?? [],
        evidenceRefs: [],
        warnings: [assemblyNote],
      },
    ],
    rootCauseCandidates: (assessment?.rootCauseCandidates?.length ? assessment.rootCauseCandidates : []).map((c, rank) => ({
      candidateId: c.id ?? `rc-${rank}`,
      label: c.label ?? c.id ?? "unknown",
      confidence: typeof c.confidence === "number" ? c.confidence : 0.4,
      rank: rank + 1,
      supportingEvidenceRefs: [],
      opposingOrMissingEvidence: [assemblyNote],
      basis: c.evidence ?? "minimal fallback",
    })),
    evidence: timeline.slice(0, MAX_EVIDENCE_ITEMS).map((t, i) => ({
      eventId: t.id ?? `ev-${i}`,
      sourceId: "unknown",
      sourceType: "file",
      timestamp: t.timestamp ?? "unknown",
      service: t.service ?? "unknown-service",
      normalizedMessage: t.message ?? "",
      tags: ["fallback-row"],
    })),
    ruleDiagnostics: [
      {
        ruleId: "minimal",
        ruleName: "Fallback assembly",
        matched: false,
        reasons: [assemblyNote],
        warnings: [assemblyNote],
      },
    ],
    missingEvidenceAndUncertainty: [
      assemblyNote,
      "Heuristic engine returned partial or inconsistent structure; enrich with care.",
    ],
    recommendedChecks: (assessment?.recommendedActions?.length ? assessment.recommendedActions : ["Add more logs from affected services"]).map(
      (text, i) => ({
        checkId: `fb-${i}`,
        text,
        reason: "Fallback recommendation",
        priority: "high" as const,
      }),
    ),
    layering: {
      observedEventIds: timeline.map((t) => t.id).filter(Boolean) as string[],
      heuristicFindingIds: ["assembly-fallback"],
      causalHypothesisChainIds: ["minimal"],
    },
    legacySchema,
  };
}

export function buildEnrichRequest(result: AnalysisResult, options?: BuildEnrichRequestOptions): EnrichRequest {
  try {
    return buildEnrichRequestCore(result, options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return minimalEnrichRequestFromResult(result, options, `buildEnrichRequest: ${msg}`);
  }
}

function buildEnrichRequestCore(result: AnalysisResult, options?: BuildEnrichRequestOptions): EnrichRequest {
  const schema = result.schema;
  if (!schema?.summary || !schema?.assessment) {
    throw new Error("missing schema.summary or schema.assessment");
  }
  const corr = result.correlationSnapshot;
  const mode = options?.mode ?? "batch";
  const incidentId = options?.incidentId ?? randomUUID();
  const window = result.analysisWindow ?? {
    start: schema.summary.incidentWindow?.start ?? "unknown",
    end: schema.summary.incidentWindow?.end ?? "unknown",
    durationSeconds: 0,
  };

  const metadata: EnrichMetadata = {
    enrichVersion: "2.0",
    schemaVersion: schema.schemaVersion ?? "1.0.0",
    incidentId,
    generatedAt: schema.generatedAt ?? new Date().toISOString(),
    mode,
    analysisWindow: {
      start: window.start,
      end: window.end,
      durationSeconds: window.durationSeconds,
    },
  };

  const deps = new Set<string>();
  for (const e of schema.traceGraph?.edges ?? []) {
    deps.add(`${e.from}->${e.to}`);
  }
  for (const ev of result.parsedEvents ?? []) {
    for (const d of ev.inferredDependencies ?? []) deps.add(d);
  }

  const affected = [...new Set(schema.summary?.affectedServices ?? [])];
  const impactScope: EnrichImpactScope = {
    affectedServices: affected,
    suspectedDependencies: [...deps].slice(0, 32),
    severity: schema.assessment.severity,
    blastRadius:
      affected.length <= 1 ? "single_service" : affected.length > 3 ? "multi_service" : "multi_service",
    userJourneyOrPath: (schema.flow?.length
      ? schema.flow.map((f) => `${f.from}→${f.to}`)
      : (schema.traceGraph?.edges ?? []).map((e) => `${e.from}→${e.to}`)
    )
      .slice(0, 8)
      .join(", "),
  };

  const missingSourceHints: string[] = [
    "kubernetes_events:not_in_payload",
    "infra_metrics:not_in_payload",
    "network_telemetry:not_in_payload",
  ];
  const servicesInTimeline = new Set(result.timeline.map((t) => t.service).filter(Boolean));
  for (const t of schema.traceGraph.triggerCandidates ?? []) {
    if (t.service && t.service !== "unknown-service" && !servicesInTimeline.has(t.service)) {
      missingSourceHints.push(`logs_from_service:${t.service}`);
    }
  }

  const inputs = result.inputSources ?? [];
  const sourceSummary: EnrichSourceSummary = {
    sourceCount: inputs.length,
    sourceTypes: [...new Set(inputs.map((s) => s.kind))],
    sourceIds: inputs.map((s) => s.name),
    missingExpectedSources: missingSourceHints.slice(0, 12),
  };

  let findings: EnrichFinding[] = [];
  if (corr?.findings?.length) {
    findings = corr.findings.map(mapCorrelationFinding);
  } else {
    findings = signalsToFindings(result);
  }

  let causalChains: EnrichCausalChain[] = [];
  if (corr?.causalChains?.length) {
    causalChains = corr.causalChains.map(mapCausalChain);
  } else if ((schema.assessment.propagationChain?.length ?? 0) > 0) {
    causalChains = (schema.assessment.propagationChain ?? []).slice(0, 12).map((line, i) => ({
      chainId: `prop-${i}`,
      title: `Propagation ${i + 1}`,
      classification: "heuristic_propagation",
      overallConfidence: 0.55,
      orderedSteps: [line],
      involvedServices: schema.summary.affectedServices,
      evidenceRefs: [],
      warnings: ["Inferred from timeline sequence, not multi-source corroboration."],
    }));
  } else if ((schema.traceGraph?.edges?.length ?? 0) > 0) {
    causalChains = (schema.traceGraph.edges ?? []).slice(0, 12).map((e, i) => ({
      chainId: `edge-${i}`,
      title: `${e.from} → ${e.to}: ${e.annotation}`,
      classification: "heuristic_trace_edge",
      overallConfidence: e.confidence,
      orderedSteps: [`${e.from} impacts ${e.to} (${e.annotation})`],
      involvedServices: [e.from, e.to],
      evidenceRefs: [],
      warnings: ["Derived from trace graph edge, not corroborated across sources."],
    }));
  } else {
    causalChains = [
      {
        chainId: "chain-fallback",
        title: "No explicit propagation chain",
        classification: "insufficient_structure",
        overallConfidence: 0.35,
        orderedSteps: ["Engine did not produce propagation edges for this input."],
        involvedServices: schema.summary?.affectedServices ?? [],
        evidenceRefs: [],
        warnings: ["Sparse graph; causal ordering may be incomplete."],
      },
    ];
  }

  const rcList = schema.assessment.rootCauseCandidates?.length
    ? schema.assessment.rootCauseCandidates
    : [
        {
          id: "no_dominant_rc",
          label: "No dominant root cause",
          confidence: 0.35,
          evidence: "Engine did not rank a strong candidate.",
        },
      ];
  const rootCauseCandidates: EnrichRootCauseCandidate[] = rcList.map((c, rank) => ({
    candidateId: c.id,
    label: c.label ?? c.id,
    confidence: c.confidence,
    rank: rank + 1,
    supportingEvidenceRefs: result.timeline.filter((t) => c.affectedServices?.includes(t.service)).slice(0, 6).map((t) => t.id),
    opposingOrMissingEvidence: buildMissingEvidence(result).slice(0, 3),
    basis: c.evidence || `weighted=${c.weightedScore?.toFixed(2) ?? "n/a"}`,
  }));

  const evidence: EnrichEvidence[] = [];
  const parsed = result.parsedEvents ?? [];
  const timeline = schema.timeline ?? [];
  if (timeline.length === 0) {
    throw new Error("empty timeline");
  }

  for (let i = 0; i < Math.min(timeline.length, MAX_EVIDENCE_ITEMS); i++) {
    const t = timeline[i];
    const p = parsed.find((x) => x.message === t.message && x.timestamp === t.timestamp) ?? parsed[i];
    evidence.push({
      eventId: t.id,
      sourceId: p?.sourceName ?? result.inputSources[0]?.name ?? "unknown",
      sourceType: p?.source ?? "file",
      timestamp: t.timestamp,
      service: t.service,
      hostPodContainer: [t.host, p?.pid].filter(Boolean).join("/") || undefined,
      normalizedMessage: t.message,
      rawExcerpt: p?.rawLine ? trimExcerpt(p.rawLine) : undefined,
      parserId: "parser-registry",
      parseConfidence: p?.parseConfidence,
      tags: p?.tags?.length ? p.tags : p?.normalizedType ? [p.normalizedType] : undefined,
      confidence: t.anomaly ? 0.75 : 0.5,
    });
  }

  const ruleDiagnostics = buildRuleDiagnostics(result, corr);

  const missingEvidenceAndUncertainty = buildMissingEvidence(result);

  const actions = schema.assessment.recommendedActions?.length
    ? schema.assessment.recommendedActions
    : ["Collect additional logs from affected services", "Validate timestamps and service attribution"];
  const recommendedChecks: EnrichRecommendedCheckInput[] = actions.map((text, i) => ({
    checkId: `check-${i}`,
    text,
    reason: "Heuristic recommendation from local assessment.",
    targetCandidateId: rcList[0]?.id,
    priority: i < 2 ? ("high" as const) : "medium",
    supportingEvidenceRefs: rcList[0]
      ? evidence.filter((e) => e.service === schema.assessment.primaryService).slice(0, 3).map((e) => e.eventId)
      : [],
  }));

  const observedEventIds = evidence.map((e) => e.eventId);
  const layering: EnrichLayering = {
    observedEventIds,
    heuristicFindingIds: findings.map((f) => f.findingId),
    causalHypothesisChainIds: causalChains.map((c) => c.chainId),
  };

  return {
    enrichVersion: "2.0",
    metadata,
    impactScope,
    sourceSummary,
    findings,
    causalChains,
    rootCauseCandidates,
    evidence,
    ruleDiagnostics,
    missingEvidenceAndUncertainty,
    recommendedChecks,
    layering,
    legacySchema: schema,
  };
}
