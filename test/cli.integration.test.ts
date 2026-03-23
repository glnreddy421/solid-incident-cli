import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const CLI_PATH = join(process.cwd(), "dist/index.js");
const SAMPLE_PATH = join(process.cwd(), "samples/payment.log");

describe("CLI integration", () => {
  beforeAll(() => {
    execSync("npm run build", { cwd: process.cwd(), stdio: "pipe" });
  });

  it("solidx --version prints version", () => {
    const out = execSync(`node ${CLI_PATH} --version`, { encoding: "utf-8" });
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version: string };
    expect(out.trim()).toBe(packageJson.version);
  });

  it("solidx --help prints help", () => {
    const out = execSync(`node ${CLI_PATH} --help`, { encoding: "utf-8" });
    expect(out).toContain("solidx");
    expect(out).toContain("analyze");
    expect(out).toContain("report");
    expect(out).toContain("session");
    expect(out).toContain("export");
  });

  it("solidx analyze <file> --json produces valid JSON output mode", () => {
    const out = execSync(`node ${CLI_PATH} analyze ${SAMPLE_PATH} --json`, { encoding: "utf-8" });
    const parsed = JSON.parse(out);
    expect(parsed).toHaveProperty("summary");
    expect(parsed).toHaveProperty("signals");
    expect(parsed).toHaveProperty("timeline");
    expect(parsed).toHaveProperty("schema");
    expect(Array.isArray(parsed.timeline)).toBe(true);
    expect(Array.isArray(parsed.signals)).toBe(true);
    expect(parsed.summary).toHaveProperty("incidentSummary");
    expect(parsed.summary).toHaveProperty("triggerEvent");
    expect(parsed.summary).toHaveProperty("affectedServices");
  });

  it("solidx analyze <file> --md produces markdown", () => {
    const out = execSync(`node ${CLI_PATH} analyze ${SAMPLE_PATH} --md --no-ai`, { encoding: "utf-8" });
    expect(out).toContain("# SOLID Incident Report");
    expect(out).toContain("Summary");
  });

  it("solidx analyze <file> --no-tui forces non-tui text mode", () => {
    const out = execSync(`node ${CLI_PATH} analyze ${SAMPLE_PATH} --no-tui --no-ai`, { encoding: "utf-8" });
    expect(out).toContain("SOLID INCIDENT ANALYSIS");
    expect(out).toContain("Timeline");
  });

  it("solidx analyze nonexistent.txt exits with error", () => {
    try {
      execSync(`node ${CLI_PATH} analyze nonexistent.txt`, { encoding: "utf-8", stdio: "pipe" });
    } catch (err: unknown) {
      const e = err as { status: number };
      expect(e.status).toBe(1);
    }
  });

  it("solidx analyze capture.har --json produces valid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "solid-cli-har-"));
    const harPath = join(dir, "capture.har");
    writeFileSync(
      harPath,
      JSON.stringify({
        log: {
          entries: [
            {
              startedDateTime: "2024-03-08T14:02:12Z",
              time: 50,
              request: { method: "GET", url: "https://api.example.com/health" },
              response: { status: 200 },
            },
          ],
        },
      }),
    );
    const out = execSync(`node ${CLI_PATH} analyze ${harPath} --json --no-ai`, { encoding: "utf-8" });
    const parsed = JSON.parse(out);
    expect(parsed).toHaveProperty("summary");
    expect(parsed).toHaveProperty("timeline");
    expect(Array.isArray(parsed.timeline)).toBe(true);
    expect(parsed.timeline.length).toBeGreaterThanOrEqual(1);
  });

  it("solidx report renders deterministic RCA markdown from analyze JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "solid-report-"));
    const jsonPath = join(dir, "analysis.json");
    const outPath = join(dir, "rca.md");
    const json = execSync(`node ${CLI_PATH} analyze ${SAMPLE_PATH} --json --no-ai`, { encoding: "utf-8" });
    writeFileSync(jsonPath, json);
    execSync(`node ${CLI_PATH} report ${jsonPath} -s rca -o ${outPath}`, { encoding: "utf-8" });
    const md = readFileSync(outPath, "utf8");
    expect(md).toContain("# Root cause analysis");
    expect(md).toContain("## Incident summary");
    expect(md).toContain("**No LLM**");
  });
});
