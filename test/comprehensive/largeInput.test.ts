import { describe, expect, it } from "vitest";
import { parseLines } from "../../src/utils/parser.js";
import { analyzeLocally } from "../../src/engine/analysisEngine.js";
import { toRawLines } from "../fixtures/helpers.js";

describe("large input handling", () => {
  it("parses 2000 lines in reasonable time", () => {
    const lines = Array.from({ length: 2000 }, (_, i) =>
      `2024-03-08T14:02:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z api info: event ${i}`,
    );
    const start = Date.now();
    const events = parseLines(toRawLines(lines));
    const elapsed = Date.now() - start;
    expect(events.length).toBe(2000);
    expect(elapsed).toBeLessThan(5000);
  });

  it("engine processes 1000 lines and produces valid result", () => {
    const lines = Array.from({ length: 1000 }, (_, i) =>
      `2024-03-08T14:02:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z api info: event ${i}`,
    );
    const start = Date.now();
    const result = analyzeLocally({
      rawLines: toRawLines(lines),
      inputSources: [{ kind: "file", name: "large.log" }],
      mode: "text",
    });
    const elapsed = Date.now() - start;
    expect(result.timeline.length).toBe(1000);
    expect(result.assessment).toBeDefined();
    expect(elapsed).toBeLessThan(10000);
  });
});
