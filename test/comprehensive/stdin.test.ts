import { describe, expect, it, beforeAll } from "vitest";
import { execSync } from "child_process";
import { join } from "path";

const CLI_PATH = join(process.cwd(), "dist/index.js");

describe("stdin pipe mode", () => {
  beforeAll(() => {
    execSync("npm run build", { cwd: process.cwd(), stdio: "pipe" });
  });

  it("reads from stdin when no files provided and produces valid JSON", () => {
    const input = [
      "2024-03-08T14:02:12Z api info: started",
      "2024-03-08T14:02:13Z api error: connection refused",
    ].join("\n");
    const out = execSync(`node ${CLI_PATH} analyze --json --no-ai`, {
      encoding: "utf-8",
      input,
    });
    const parsed = JSON.parse(out);
    expect(parsed).toHaveProperty("summary");
    expect(parsed).toHaveProperty("timeline");
    expect(Array.isArray(parsed.timeline)).toBe(true);
    expect(parsed.timeline.length).toBe(2);
    expect(parsed.summary).toHaveProperty("incidentSummary");
  });

  it("stdin with HAR-like JSON structure routes through adapter", () => {
    const harInput = JSON.stringify({
      log: {
        entries: [
          {
            startedDateTime: "2024-03-08T14:02:12Z",
            time: 50,
            request: { method: "POST", url: "https://api.example.com/login" },
            response: { status: 200 },
          },
        ],
      },
    });
    const out = execSync(`node ${CLI_PATH} analyze --json --no-ai`, {
      encoding: "utf-8",
      input: harInput,
    });
    const parsed = JSON.parse(out);
    expect(parsed.timeline.length).toBeGreaterThanOrEqual(1);
  });
});
