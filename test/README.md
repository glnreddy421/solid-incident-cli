# SOLID Diagnostics Platform Test Suite

## Test Architecture

- **Framework**: Vitest
- **Structure**: Flat `test/` root with subfolders for domain-specific tests
- **Fixtures**: `test/fixtures/helpers.ts` – shared factories and log samples

## Test Categories

### Parsers (`test/parsers/`)
- **parserRegistry.test.ts**: Deterministic selection, individual parsers (k8s, json, syslog, iso-text, key-value, bracketed, generic), ambiguous competition, negative guards, partial parse, malformed resilience
- **backwardCompatibility.test.ts**: parseLines() API stability, engine compatibility, additive metadata

### Adapters (`test/adapters/`)
- **adapterRegistry.test.ts**: Deterministic selection, source routing (text-log, HAR, PCAP), HAR/PCAP behavior, unsupported input, multi-file via loadInput

### Canonical (`test/canonical/`)
- **canonicalEvent.test.ts**: Core fields, diagnostics (parser/adapter), serializability

### Correlation (`test/correlation/`)
- **rollingWindow.test.ts**: Event entry, age-out, ordering
- **grouping.test.ts**: Service/time grouping, unrelated singletons, timeWindow/groupingReasons
- **heuristics.test.ts**: timeout-retry-failure, error-burst, cross-source, user-visible-backend, connection-failure-cluster
- **confidence.test.ts**: Confidence scoring, strength classification

### Engine (`test/engine/`)
- **batchEngine.e2e.test.ts**: Single/multi-file batch flow, loadInput → analyze, schema validation
- **liveEngine.e2e.test.ts**: Live start → append → snapshot → stop, safe double-stop

### Diagnostics (`test/diagnostics/`)
- **explainability.test.ts**: Parser/adapter diagnostics on events, findings (evidenceRefs, ruleId, ruleDiagnostics), chains (involvedServices, orderedSteps, evidenceSources)

### Resilience (`test/resilience/`)
- **safety.test.ts**: Long lines, malformed lines, control chars, empty files, duplicate/out-of-order timestamps, hostile engine input

### Comprehensive (`test/comprehensive/`)
- **stdin.test.ts**: Stdin pipe mode, HAR via stdin
- **harEngineFlow.test.ts**: loadInput(har) → analyzeLocally full flow
- **sessionSaveLoad.test.ts**: saveSession, getSession, listSessions, deleteSession round-trip
- **tuiPanelSpecs.test.ts**: All TUI panels (main/side) render without crash
- **largeInput.test.ts**: 2000-line parse, 1000-line engine (performance)
- **mixedSources.test.ts**: file1.log + file2.har in one loadInput, multi-log merge

### Legacy / Integration
- **parser.test.ts**, **inputAdapters.test.ts**, **correlation.test.ts**, **liveAnalysis.test.ts**: Original tests preserved
- **cli.integration.test.ts**: CLI e2e (includes HAR file analyze)
- **incidentAssessment.test.ts**: Verdict/assessment behavior

## Running Tests

```bash
npm test              # Full suite
npm test -- test/parsers   # Parser tests only
npm test -- test/correlation  # Correlation tests only
```

## Coverage Summary

| Area | Covered |
|------|---------|
| Parser registry | Deterministic selection, all parsers, ambiguity, negative guards, resilience |
| parseLines() compatibility | Input/output shape, engine callers, additive metadata |
| Adapter registry | Selection, routing, HAR, PCAP, unsupported, multi-file |
| Canonical event | Core fields, diagnostics, serializability |
| Correlation | Rolling window, grouping, heuristics, confidence |
| Live tailing | Multi-file, partial buffering, truncation, shutdown |
| Batch engine | Single/multi-file, schema validation |
| Diagnostics | Parser/adapter/correlation explainability |
| Resilience | Long lines, malformed, control chars, empty, timestamps |

## Remaining Gaps / Future Tests

- **PCAP full decode**: When implemented, add event extraction tests
- **Dynamic bucket/window tuning**: If added, test deterministic behavior
