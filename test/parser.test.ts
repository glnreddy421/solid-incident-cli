import { describe, it, expect } from "vitest";
import { parseLines, formatTimestampForDisplay } from "../src/utils/parser.js";

describe("parseLines", () => {
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

  it("skips empty lines", () => {
    const raw = [
      { line: "", lineNumber: 1 },
      { line: "   ", lineNumber: 2 },
      { line: "2024-03-08T14:02:00Z valid", lineNumber: 3 },
    ];
    const events = parseLines(raw);
    expect(events).toHaveLength(1);
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
