import { describe, expect, it } from "vitest";
import { parseLines } from "../../src/utils/parser.js";
import { analyzeLocally } from "../../src/engine/analysisEngine.js";
import { toRawLines } from "../fixtures/helpers.js";

describe("parseLines backward compatibility", () => {
  it("preserves existing input/output shape", () => {
    const raw = [{ line: "2024-03-08T14:02:12Z error: failed", lineNumber: 1, source: "file" as const }];
    const events = parseLines(raw);
    expect(events).toHaveLength(1);
    expect(events[0]).toHaveProperty("timestamp");
    expect(events[0]).toHaveProperty("service");
    expect(events[0]).toHaveProperty("severity");
    expect(events[0]).toHaveProperty("message");
    expect(events[0]).toHaveProperty("lineNumber");
  });

  it("engine callers receive compatible ParsedEvent shape", () => {
    const result = analyzeLocally({
      rawLines: toRawLines(["2024-03-08T14:02:12Z api error: connection refused"]),
      inputSources: [{ kind: "file", name: "test.log" }],
      mode: "text",
    });
    expect(result.timeline.length).toBeGreaterThan(0);
    expect(result.signals.length).toBeGreaterThanOrEqual(0);
    expect(result.assessment).toBeDefined();
  });

  it("new metadata fields are additive", () => {
    const events = parseLines(toRawLines(["2024-03-08T14:02:12Z info started"]));
    expect(events[0].parserId).toBeDefined();
    expect(events[0].parseConfidence).toBeDefined();
    expect(events[0].parseReasons).toBeDefined();
    expect(events[0].severity).toBeDefined();
    expect(events[0].message).toBeDefined();
  });

  it("batch parse behavior stable across representative fixtures", () => {
    const fixture = [
      "2024-03-08T14:02:12Z service=api level=error msg=\"boom\"",
      "Mar 14 01:04:31 host syslogd[540]: ASL Sender Statistics",
      '{"level":"info","msg":"startup","service":"api","timestamp":"2024-03-08T14:02:12Z"}',
    ];
    const run1 = parseLines(toRawLines(fixture));
    const run2 = parseLines(toRawLines(fixture));
    expect(run1.length).toBe(run2.length);
    for (let i = 0; i < run1.length; i++) {
      expect(run1[i].parserId).toBe(run2[i].parserId);
      expect(run1[i].service).toBe(run2[i].service);
      expect(run1[i].message).toBe(run2[i].message);
    }
  });
});
