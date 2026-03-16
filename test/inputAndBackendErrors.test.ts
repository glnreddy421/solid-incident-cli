import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { BackendAiClient } from "../src/api/backendClient.js";
import { loadInput } from "../src/cli/input.js";
import { BackendUnavailableError, InputError } from "../src/contracts/index.js";

describe("error handling", () => {
  it("returns invalid input error for bad file path", async () => {
    await expect(loadInput(["/definitely/not/found.log"])).rejects.toBeInstanceOf(InputError);
  });

  it("loads HAR files via adapter layer and returns synthetic lines", async () => {
    const dir = mkdtempSync(join(tmpdir(), "solid-har-"));
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
          ],
        },
      }),
    );
    const result = await loadInput([harPath]);
    expect(result.lines.length).toBe(1);
    expect(result.lines[0].line).toContain("GET");
    expect(result.lines[0].line).toContain("200");
    expect(result.sources).toEqual([{ kind: "file", name: harPath }]);
  });

  it("handles backend unavailable behavior", async () => {
    process.env.SOLID_TEST_BACKEND_DOWN = "1";
    const client = new BackendAiClient({ baseUrl: "https://example.invalid" });
    await expect(
      client.enrichIncident({
        schemaVersion: "1.0.0",
        generatedAt: new Date().toISOString(),
        timeline: [],
        flow: [],
        signals: [],
        summary: {
          incidentSummary: "x",
          triggerEvent: "y",
          confidence: 1,
          affectedServices: [],
          incidentWindow: { start: "unknown", end: "unknown" },
        },
      })
    ).rejects.toBeInstanceOf(BackendUnavailableError);
    delete process.env.SOLID_TEST_BACKEND_DOWN;
  });
});

