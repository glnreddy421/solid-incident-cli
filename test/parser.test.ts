import { describe, it, expect } from "vitest";
import { parseLines, formatTimestampForDisplay } from "../src/utils/parser.js";
import { getParserMetrics, resetParserMetrics } from "../src/utils/parserRegistry.js";

describe("parseLines", () => {
  it("records parser diagnostics metadata", () => {
    resetParserMetrics();
    const raw = [{ line: "2024-03-08T14:02:12.456Z service=api level=error msg=\"boom\"", lineNumber: 1 }];
    const events = parseLines(raw);
    expect(events[0].parserId).toBeDefined();
    expect(events[0].parseConfidence).toBeGreaterThan(0);
    expect(events[0].parseReasons?.length ?? 0).toBeGreaterThan(0);
    expect(events[0].candidateParsers?.length ?? 0).toBeGreaterThan(0);
    const metrics = getParserMetrics();
    expect(Object.values(metrics.parserHits).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("parses ISO timestamp and JSON log line", () => {
    const raw = [
      { line: '2024-03-08T14:02:12.456Z {"level":"error","msg":"connection refused","service":"payment-service"}', lineNumber: 1 },
    ];
    const events = parseLines(raw);
    expect(events).toHaveLength(1);
    expect(events[0].timestamp).toMatch(/2024-03-08/);
    expect(events[0].service).toBe("payment-service");
    expect(events[0].severity).toBe("error");
    expect(events[0].message).toBe("connection refused");
    expect(events[0].parserId).toBe("iso-text");
  });

  it("parses Kubernetes-style prefix", () => {
    const raw = [
      { line: "2024-03-08T14:02:11.123Z stdout F {\"level\":\"info\",\"msg\":\"Starting payment-service\",\"service\":\"payment-service\"}", lineNumber: 1 },
    ];
    const events = parseLines(raw);
    expect(events).toHaveLength(1);
    expect(events[0].timestamp).toBe("2024-03-08T14:02:11.123Z");
    expect(events[0].service).toBe("payment-service");
    expect(events[0].severity).toBe("info");
    expect(events[0].parserId).toBe("k8s-container");
  });

  it("infers severity from keywords", () => {
    const raw = [
      { line: "2024-03-08T14:02:00Z error: something failed", lineNumber: 1 },
      { line: "2024-03-08T14:02:01Z warn: retry attempt", lineNumber: 2 },
      { line: "2024-03-08T14:02:02Z info: started", lineNumber: 3 },
    ];
    const events = parseLines(raw);
    expect(events[0].severity).toBe("error");
    expect(events[1].severity).toBe("warning");
    expect(events[2].severity).toBe("info");
  });

  it("sorts events by timestamp", () => {
    const raw = [
      { line: "2024-03-08T14:02:03Z event c", lineNumber: 1 },
      { line: "2024-03-08T14:02:01Z event a", lineNumber: 2 },
      { line: "2024-03-08T14:02:02Z event b", lineNumber: 3 },
    ];
    const events = parseLines(raw);
    expect(events[0].message).toContain("a");
    expect(events[1].message).toContain("b");
    expect(events[2].message).toContain("c");
  });

  it("chooses iso-text over key-value for timestamp-prefixed payload", () => {
    const raw = [
      { line: '2024-03-08T14:02:12Z service=api level=error msg="failed dependency"', lineNumber: 1 },
    ];
    const events = parseLines(raw);
    expect(events[0].parserId).toBe("iso-text");
    expect(events[0].service).toBe("api");
  });

  it("chooses syslog parser for syslog with key-value body", () => {
    const raw = [
      { line: "Mar 14 01:09:00 host api[91]: level=error msg=\"db timeout\" trace_id=abc", lineNumber: 1 },
    ];
    const events = parseLines(raw);
    expect(events[0].parserId).toBe("syslog-rfc3164");
    expect(events[0].service).toBe("api");
    expect(events[0].host).toBe("host");
  });

  it("chooses bracketed parser over key-value when envelope is bracketed", () => {
    const raw = [
      { line: "[2024-03-08T14:02:12Z] [error] [auth-service] service=auth msg=token expired", lineNumber: 1 },
    ];
    const events = parseLines(raw);
    expect(events[0].parserId).toBe("bracketed");
    expect(events[0].service).toBe("auth-service");
    expect(events[0].severity).toBe("error");
  });

  it("falls back to generic for accidental equals text", () => {
    const raw = [
      { line: "A=B testing rollout version one", lineNumber: 1 },
    ];
    const events = parseLines(raw);
    expect(events[0].parserId).toBe("generic");
    expect(events[0].parseWarnings?.join(" ")).toContain("no structured parser matched strongly");
  });

  it("keeps outer parse with warning when ISO + malformed JSON payload", () => {
    const raw = [
      { line: "2024-03-08T14:02:12Z {\"level\":\"error\",\"msg\":\"boom\"", lineNumber: 1 },
    ];
    const events = parseLines(raw);
    expect(events[0].parserId).toBe("iso-text");
    expect(events[0].parseWarnings?.join(" ")).toContain("JSON parse failed");
  });

  it("handles short noisy lines via generic parser", () => {
    const raw = [{ line: "???", lineNumber: 1 }];
    const events = parseLines(raw);
    expect(events[0].parserId).toBe("generic");
    expect(events[0].parseConfidence).toBeLessThanOrEqual(0.5);
  });

  it("skips empty lines", () => {
    const raw = [
      { line: "", lineNumber: 1 },
      { line: "   ", lineNumber: 2 },
      { line: "2024-03-08T14:02:00Z valid", lineNumber: 3 },
    ];
    const events = parseLines(raw);
    expect(events).toHaveLength(1);
  });

  it("degrades gracefully on malformed/truncated inputs", () => {
    const veryLong = `2024-03-08T14:02:12Z level=info service=api msg="${"x".repeat(5000)}"`;
    const raw = [
      { line: '{"level":"error","msg":"broken quote}', lineNumber: 1 },
      { line: "2024-03-08T14:02:12 broken ts", lineNumber: 2 },
      { line: "level=error msg=\"oops service=api", lineNumber: 3 },
      { line: "api ERROR \u0000\u0001 weird control chars", lineNumber: 4 },
      { line: veryLong, lineNumber: 5 },
      { line: "1710022334 service=api level=info msg=epoch seconds", lineNumber: 6 },
      { line: "1710022334000 service=api level=info msg=epoch millis", lineNumber: 7 },
    ];
    const events = parseLines(raw);
    expect(events.length).toBe(7);
    for (const event of events) {
      expect(event.message.length).toBeGreaterThan(0);
      expect(event.parserId).toBeDefined();
    }
    const epochSec = events.find((e) => e.message.includes("epoch seconds"));
    const epochMs = events.find((e) => e.message.includes("epoch millis"));
    expect(epochSec?.timestamp).not.toBe("unknown");
    expect(epochMs?.timestamp).not.toBe("unknown");
  });
});

describe("formatTimestampForDisplay", () => {
  it("formats ISO timestamp to HH:MM:SS", () => {
    expect(formatTimestampForDisplay("2024-03-08T14:02:12.456Z")).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("returns unknown for unknown timestamp", () => {
    expect(formatTimestampForDisplay("unknown")).toBe("unknown");
  });
});
