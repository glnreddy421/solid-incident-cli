import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { loadInput } from "../../src/cli/input.js";
import { analyzeLocally } from "../../src/engine/analysisEngine.js";

describe("mixed sources in one run", () => {
  it("loadInput with file1.log + file2.har merges and preserves source metadata", async () => {
    const dir = mkdtempSync(join(tmpdir(), "solid-mixed-"));
    const logPath = join(dir, "app.log");
    const harPath = join(dir, "capture.har");
    writeFileSync(
      logPath,
      "2024-03-08T14:02:12Z api info: from log file\n",
      "utf8",
    );
    writeFileSync(
      harPath,
      JSON.stringify({
        log: {
          entries: [
            {
              startedDateTime: "2024-03-08T14:02:13Z",
              time: 42,
              request: { method: "GET", url: "https://api.example.com/health" },
              response: { status: 200 },
            },
          ],
        },
      }),
      "utf8",
    );

    const input = await loadInput([logPath, harPath]);
    expect(input.lines.length).toBe(2);
    expect(input.sources).toHaveLength(2);
    expect(input.lines.some((l) => l.sourceName?.includes("app.log"))).toBe(true);
    expect(input.lines.some((l) => l.sourceName?.includes("capture.har"))).toBe(true);
    expect(input.lines.some((l) => l.line.includes("from log file"))).toBe(true);
    expect(input.lines.some((l) => l.line.includes("GET") && l.line.includes("200"))).toBe(true);

    const result = analyzeLocally({
      rawLines: input.lines,
      inputSources: input.sources,
      mode: "text",
    });
    expect(result.timeline.length).toBe(2);
    expect(result.assessment).toBeDefined();
  });

  it("loadInput with multiple log files merges with global line numbers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "solid-multi-log-"));
    const a = join(dir, "a.log");
    const b = join(dir, "b.log");
    writeFileSync(a, "2024-03-08T14:02:12Z api info: from a\n", "utf8");
    writeFileSync(b, "2024-03-08T14:02:13Z gateway info: from b\n", "utf8");

    const input = await loadInput([a, b]);
    expect(input.lines.length).toBe(2);
    expect(input.lines[0].lineNumber).toBe(1);
    expect(input.lines[1].lineNumber).toBe(2);
    expect(input.lines[0].sourceName).toContain("a.log");
    expect(input.lines[1].sourceName).toContain("b.log");
  });
});
