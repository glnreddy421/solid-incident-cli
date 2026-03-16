import { describe, expect, it } from "vitest";
import { analyzeLocally } from "../../src/engine/analysisEngine.js";
import { loadInput } from "../../src/cli/input.js";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { toRawLines } from "../fixtures/helpers.js";

describe("batch engine e2e - single log file", () => {
  it("ingest -> parse -> assessment produces structured output", () => {
    const result = analyzeLocally({
      rawLines: toRawLines([
        "2024-03-08T14:02:12Z service=api level=error msg=\"connection refused\"",
        "2024-03-08T14:02:13Z service=api level=warning msg=\"retry attempt 1/3\"",
        "2024-03-08T14:02:14Z service=api level=error msg=\"failed dependency\"",
      ]),
      inputSources: [{ kind: "file", name: "incident.log" }],
      mode: "text",
    });
    expect(result.assessment).toBeDefined();
    expect(result.assessment.verdict).toBeDefined();
    expect(result.timeline.length).toBe(3);
    expect(result.signals.length).toBeGreaterThanOrEqual(0);
    expect(result.traceGraph).toBeDefined();
    expect(result.traceGraph.nodes.length).toBeGreaterThanOrEqual(0);
    expect(result.assessment.rootCauseCandidates.length).toBeGreaterThanOrEqual(0);
  });
});

describe("batch engine e2e - via loadInput (adapter path)", () => {
  it("loadInput -> analyze produces valid result", async () => {
    const dir = mkdtempSync(join(tmpdir(), "solid-e2e-"));
    const logPath = join(dir, "app.log");
    writeFileSync(
      logPath,
      [
        "2024-03-08T14:02:12Z api error: connection refused",
        "2024-03-08T14:02:13Z api warn: retry 1/3",
        "2024-03-08T14:02:14Z gateway error: 503 upstream",
      ].join("\n"),
      "utf8",
    );
    const input = await loadInput([logPath]);
    const result = analyzeLocally({
      rawLines: input.lines,
      inputSources: input.sources,
      mode: "text",
    });
    expect(result.timeline.length).toBe(3);
    expect(result.assessment.verdict).toBeDefined();
  });
});

describe("batch engine e2e - structured output validation", () => {
  it("result has required schema shape", () => {
    const result = analyzeLocally({
      rawLines: toRawLines(["2024-03-08T14:02:12Z info started"]),
      inputSources: [{ kind: "file", name: "x.log" }],
      mode: "text",
    });
    expect(result).toHaveProperty("summary");
    expect(result).toHaveProperty("assessment");
    expect(result).toHaveProperty("timeline");
    expect(result).toHaveProperty("signals");
    expect(result).toHaveProperty("traceGraph");
    expect(result).toHaveProperty("schema");
    expect(result.assessment).toHaveProperty("verdict");
    expect(result.assessment).toHaveProperty("severity");
    expect(result.assessment).toHaveProperty("rootCauseCandidates");
    expect(result.schema).toHaveProperty("timeline");
    expect(result.schema).toHaveProperty("assessment");
  });
});
