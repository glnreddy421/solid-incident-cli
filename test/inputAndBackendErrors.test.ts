import { describe, expect, it } from "vitest";
import { BackendAiClient } from "../src/api/backendClient.js";
import { loadInput } from "../src/cli/input.js";
import { BackendUnavailableError, InputError } from "../src/contracts/index.js";

describe("error handling", () => {
  it("returns invalid input error for bad file path", async () => {
    await expect(loadInput(["/definitely/not/found.log"])).rejects.toBeInstanceOf(InputError);
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

