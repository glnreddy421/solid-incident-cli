import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { loadInput } from "../../src/cli/input.js";
import { analyzeLocally } from "../../src/engine/analysisEngine.js";

describe("full engine flow with HAR", () => {
  it("loadInput(har) -> analyzeLocally produces valid result", async () => {
    const dir = mkdtempSync(join(tmpdir(), "solid-har-engine-"));
    const harPath = join(dir, "capture.har");
    writeFileSync(
      harPath,
      JSON.stringify({
        log: {
          entries: [
            {
              startedDateTime: "2024-03-08T14:02:12.123Z",
              time: 42.4,
              request: { method: "GET", url: "https://api.example.com/v1/health" },
              response: { status: 200 },
            },
            {
              startedDateTime: "2024-03-08T14:02:13.456Z",
              time: 120,
              request: { method: "POST", url: "https://api.example.com/orders" },
              response: { status: 500 },
            },
          ],
        },
      }),
    );
    const input = await loadInput([harPath]);
    const result = analyzeLocally({
      rawLines: input.lines,
      inputSources: input.sources,
      mode: "text",
    });
    expect(result.timeline.length).toBe(2);
    expect(result.assessment).toBeDefined();
    expect(result.assessment.verdict).toBeDefined();
    expect(result.traceGraph).toBeDefined();
    expect(result.signals).toBeDefined();
  });
});
