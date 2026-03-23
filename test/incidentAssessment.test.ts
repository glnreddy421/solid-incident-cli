import { describe, expect, it } from "vitest";
import { analyzeLocally } from "../src/engine/analysisEngine.js";
import { PANEL_SPECS } from "../src/tui/panelSpecs.js";
import { DEFAULT_TUI_LAYOUT_CONTEXT } from "../src/tui/layoutContext.js";
import type { RawLogLine } from "../src/contracts/index.js";

function toRaw(lines: string[]): RawLogLine[] {
  return lines.map((line, idx) => ({ line, lineNumber: idx + 1, source: "file" }));
}

describe("incident assessment and summary panel", () => {
  it("routine syslog is classified as no incident", () => {
    const result = analyzeLocally({
      rawLines: toRaw([
        "Mar 14 01:04:31 host syslogd[540]: ASL Sender Statistics",
        "Mar 14 01:04:32 host syslogd[540]: ASL Module statistics",
        "Mar 14 01:04:33 host syslogd[540]: checkpoint complete",
      ]),
      inputSources: [{ kind: "file", name: "routine.log" }],
      mode: "text",
    });
    expect(result.assessment.verdict).toBe("NO INCIDENT");
    expect(result.assessment.triggerClassification).toBe("routine_telemetry");
    expect(result.assessment.primaryService).toBe("syslogd");
    const lines = PANEL_SPECS.summary.main(result, "", "", DEFAULT_TUI_LAYOUT_CONTEXT);
    expect(lines.join("\n")).toContain("Incident Verdict");
    expect(lines.join("\n")).toContain("NO INCIDENT");
    expect(lines.join("\n")).toContain("informational_log_cluster");
  });

  it("warning-heavy logs are possible degradation", () => {
    const result = analyzeLocally({
      rawLines: toRaw([
        '2026-03-14T10:00:00Z {"level":"warn","msg":"retry attempt 1/3","service":"api"}',
        '2026-03-14T10:00:01Z {"level":"warn","msg":"retry attempt 2/3","service":"api"}',
        '2026-03-14T10:00:02Z {"level":"warn","msg":"latency degraded","service":"api"}',
        '2026-03-14T10:00:03Z {"level":"info","msg":"request handled","service":"api"}',
      ]),
      inputSources: [{ kind: "file", name: "warn.log" }],
      mode: "text",
    });
    expect(result.assessment.verdict).toBe("POSSIBLE DEGRADATION");
    expect(result.assessment.severity === "low" || result.assessment.severity === "medium").toBe(true);
    const lines = PANEL_SPECS.summary.main(result, "", "", DEFAULT_TUI_LAYOUT_CONTEXT);
    expect(lines.join("\n")).toContain("POSSIBLE DEGRADATION");
    expect(lines.join("\n")).toContain("retry_burst");
  });

  it("multi-service timeout/dependency failure is incident", () => {
    const result = analyzeLocally({
      rawLines: toRaw([
        '2026-03-14T10:00:00Z {"level":"error","msg":"connection timeout","service":"postgres"}',
        '2026-03-14T10:00:02Z {"level":"warn","msg":"retry storm detected","service":"worker"}',
        '2026-03-14T10:00:05Z {"level":"error","msg":"returned 500","service":"api"}',
        '2026-03-14T10:00:08Z {"level":"error","msg":"connection refused","service":"gateway"}',
      ]),
      inputSources: [{ kind: "file", name: "incident.log" }],
      mode: "text",
    });
    expect(result.assessment.verdict).toBe("INCIDENT DETECTED");
    expect(result.traceGraph.edges.length).toBeGreaterThan(0);
    expect(result.assessment.rootCauseCandidates[0]?.id.length).toBeGreaterThan(0);
  });

  it("sparse logs are insufficient evidence", () => {
    const result = analyzeLocally({
      rawLines: toRaw(['2026-03-14T10:00:00Z {"level":"info","msg":"startup complete","service":"api"}']),
      inputSources: [{ kind: "file", name: "sparse.log" }],
      mode: "text",
    });
    expect(result.assessment.verdict).toBe("INSUFFICIENT EVIDENCE");
    const lines = PANEL_SPECS.summary.main(result, "", "", DEFAULT_TUI_LAYOUT_CONTEXT);
    expect(lines.join("\n")).toContain("INSUFFICIENT EVIDENCE");
  });
});

