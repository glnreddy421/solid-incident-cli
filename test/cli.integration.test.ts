import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "child_process";
import { join } from "path";
import { existsSync, readFileSync, unlinkSync } from "fs";

const CLI_PATH = join(process.cwd(), "dist/index.js");
const SAMPLE_PATH = join(process.cwd(), "samples/payment.log");

describe("CLI integration", () => {
  beforeAll(() => {
    if (!existsSync(CLI_PATH)) {
      execSync("npm run build", { cwd: process.cwd(), stdio: "pipe" });
    }
  });

  it("solid --version prints version", () => {
    const out = execSync(`node ${CLI_PATH} --version`, { encoding: "utf-8" });
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("solid --help prints help", () => {
    const out = execSync(`node ${CLI_PATH} --help`, { encoding: "utf-8" });
    expect(out).toContain("solid");
    expect(out).toContain("analyze");
    expect(out).toContain("stream");
    expect(out).toContain("report");
  });

  it("solid analyze <file> --json produces valid JSON", () => {
    const out = execSync(`node ${CLI_PATH} analyze ${SAMPLE_PATH} --json`, { encoding: "utf-8" });
    const parsed = JSON.parse(out);
    expect(parsed).toHaveProperty("events");
    expect(parsed).toHaveProperty("signals");
    expect(parsed).toHaveProperty("summary");
    expect(parsed).toHaveProperty("rawLineCount");
    expect(Array.isArray(parsed.events)).toBe(true);
    expect(Array.isArray(parsed.signals)).toBe(true);
    expect(parsed.summary).toHaveProperty("whatHappened");
    expect(parsed.summary).toHaveProperty("likelyRootCause");
    expect(parsed.summary).toHaveProperty("impactedServices");
  });

  it("solid analyze <file> --report markdown produces markdown", () => {
    const out = execSync(`node ${CLI_PATH} analyze ${SAMPLE_PATH} --report markdown`, { encoding: "utf-8" });
    expect(out).toContain("# ");
    expect(out).toContain("Incident");
    expect(out).toContain("Summary");
  });

  it("solid analyze <file> --report json produces JSON report", () => {
    const out = execSync(`node ${CLI_PATH} analyze ${SAMPLE_PATH} --report json`, { encoding: "utf-8" });
    const parsed = JSON.parse(out);
    expect(parsed).toHaveProperty("incidentSummary");
    expect(parsed).toHaveProperty("timeline");
  });

  it("solid report <file> writes incident-report.md", () => {
    const outputPath = join(process.cwd(), "test-report-output.md");
    try {
      execSync(`node ${CLI_PATH} report ${SAMPLE_PATH} --output ${outputPath}`, { encoding: "utf-8", stdio: "pipe" });
      const content = readFileSync(outputPath, "utf-8");
      expect(content).toContain("# ");
      expect(content).toContain("Incident Report");
    } finally {
      try {
        unlinkSync(outputPath);
      } catch {
        // ignore cleanup errors
      }
    }
  });

  it("solid analyze nonexistent.txt exits with error", () => {
    try {
      execSync(`node ${CLI_PATH} analyze nonexistent.txt`, { encoding: "utf-8", stdio: "pipe" });
    } catch (err: unknown) {
      const e = err as { status: number };
      expect(e.status).toBe(1);
    }
  });
});
