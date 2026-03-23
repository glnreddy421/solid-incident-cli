import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { analyzeLocally } from "../../src/engine/analysisEngine.js";
import { runProgram } from "../../src/cli/commands.js";

describe("CLI enrich command", () => {
  it("loads analysis JSON, invokes provider, and writes output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "solid-enrich-"));
    const inputPath = join(dir, "analysis.json");
    const outputPath = join(dir, "enrich.json");

    const analysis = analyzeLocally({
      rawLines: [{ line: "[2025-01-01T00:00:00Z] payment error timeout", lineNumber: 1, source: "file", sourceName: "a.log" }],
      inputSources: [{ kind: "file", name: "a.log" }],
      mode: "text",
    });
    writeFileSync(inputPath, JSON.stringify(analysis, null, 2));

    const code = await runProgram("0.0.0-test", [
      "node",
      "solidx",
      "enrich",
      inputPath,
      "--provider",
      "noop",
      "--style",
      "questions",
      "--format",
      "json",
      "--output",
      outputPath,
    ]);

    expect(code).toBe(0);
    const payload = JSON.parse(readFileSync(outputPath, "utf8")) as {
      style: string;
      content: string;
      provider: { provider: string };
    };
    expect(payload.style).toBe("questions");
    expect(payload.provider.provider).toBe("noop");
    expect(payload.content).toContain("NOOP enrichment");
  });
});
