import { describe, expect, it } from "vitest";
import { parseLines } from "../../src/utils/parser.js";
import { getParserMetrics, resetParserMetrics } from "../../src/utils/parserRegistry.js";
import { toRawLines, LOG_FIXTURES } from "../fixtures/helpers.js";

describe("parser registry - deterministic selection", () => {
  it("same line always chooses same parser across runs", () => {
    resetParserMetrics();
    const raw = toRawLines([LOG_FIXTURES.k8s]);
    const run1 = parseLines(raw)[0].parserId;
    const run2 = parseLines(raw)[0].parserId;
    expect(run1).toBe(run2);
  });

  it("registry order is respected", () => {
    const k8s = parseLines(toRawLines([LOG_FIXTURES.k8s]))[0];
    expect(k8s.parserId).toBe("k8s-container");

    const json = parseLines(toRawLines([LOG_FIXTURES.json]))[0];
    expect(json.parserId).toBe("json");

    const syslog = parseLines(toRawLines([LOG_FIXTURES.syslog]))[0];
    expect(syslog.parserId).toBe("syslog-rfc3164");
  });
});

describe("parser registry - individual parsers", () => {
  const cases: Array<{
    name: string;
    line: string;
    expectedParser: string;
    assertions: (event: ReturnType<typeof parseLines>[0]) => void;
  }> = [
    {
      name: "k8s-container",
      line: LOG_FIXTURES.k8s,
      expectedParser: "k8s-container",
      assertions: (e) => {
        expect(e.timestamp).toBe("2024-03-08T14:02:11.123Z");
        expect(e.service).toBe("payment-service");
        expect(e.severity).toBe("info");
        expect(e.parseConfidence).toBeGreaterThan(0.8);
      },
    },
    {
      name: "json",
      line: LOG_FIXTURES.json,
      expectedParser: "json",
      assertions: (e) => {
        expect(e.service).toBe("payment-service");
        expect(e.severity).toBe("error");
        expect(e.message).toBe("connection refused");
        expect(e.parseReasons?.length).toBeGreaterThan(0);
      },
    },
    {
      name: "syslog-rfc3164",
      line: LOG_FIXTURES.syslog,
      expectedParser: "syslog-rfc3164",
      assertions: (e) => {
        expect(e.host).toBe("host");
        expect(e.service).toBe("api");
        expect(e.parseConfidence).toBeGreaterThan(0.7);
      },
    },
    {
      name: "iso-text",
      line: LOG_FIXTURES.isoText,
      expectedParser: "iso-text",
      assertions: (e) => {
        expect(e.timestamp).toMatch(/2024-03-08/);
        expect(e.service).toBe("api");
        expect(["error", "critical", "warning"]).toContain(e.severity);
      },
    },
    {
      name: "key-value",
      line: LOG_FIXTURES.keyValue,
      expectedParser: "key-value",
      assertions: (e) => {
        expect(e.level ?? e.severity).toBeDefined();
        expect(e.service).toBe("api");
        expect(e.message).toContain("failed");
      },
    },
    {
      name: "bracketed",
      line: LOG_FIXTURES.bracketed,
      expectedParser: "bracketed",
      assertions: (e) => {
        expect(e.service).toBe("auth-service");
        expect(e.severity).toBe("error");
        expect(e.parseConfidence).toBeGreaterThan(0.7);
      },
    },
    {
      name: "generic fallback",
      line: LOG_FIXTURES.generic,
      expectedParser: "generic",
      assertions: (e) => {
        expect(e.parserId).toBe("generic");
        expect(e.parseConfidence).toBeLessThanOrEqual(0.5);
        expect(e.parseWarnings?.join(" ")).toContain("no structured parser matched strongly");
      },
    },
  ];

  for (const { name, line, expectedParser, assertions } of cases) {
    it(`${name} extracts canonical fields`, () => {
      const events = parseLines(toRawLines([line]));
      expect(events).toHaveLength(1);
      expect(events[0].parserId).toBe(expectedParser);
      expect(events[0].parserId).toBeDefined();
      expect(events[0].parseConfidence).toBeDefined();
      assertions(events[0]);
    });
  }
});

describe("parser registry - ambiguous competition", () => {
  it("k8s prefix with JSON payload wins k8s", () => {
    const line = "2024-03-08T14:02:11.123Z stdout F {\"level\":\"info\",\"msg\":\"Starting\"}";
    const events = parseLines(toRawLines([line]));
    expect(events[0].parserId).toBe("k8s-container");
  });

  it("ISO timestamp + JSON payload chooses iso-text", () => {
    const line = '2024-03-08T14:02:12.456Z {"level":"error","msg":"boom","service":"api"}';
    const events = parseLines(toRawLines([line]));
    expect(events[0].parserId).toBe("iso-text");
  });

  it("syslog with key=value body chooses syslog", () => {
    const line = "Mar 14 01:09:00 host api[91]: level=error msg=\"db timeout\"";
    const events = parseLines(toRawLines([line]));
    expect(events[0].parserId).toBe("syslog-rfc3164");
  });

  it("bracketed line over key-value when envelope is bracketed", () => {
    const line = "[2024-03-08T14:02:12Z] [error] [auth-service] service=auth msg=token expired";
    const events = parseLines(toRawLines([line]));
    expect(events[0].parserId).toBe("bracketed");
  });

  it("plain text with accidental = falls to generic", () => {
    const line = "A=B testing rollout version one";
    const events = parseLines(toRawLines([line]));
    expect(events[0].parserId).toBe("generic");
  });

  it("short noisy lines fall to generic", () => {
    const events = parseLines(toRawLines(["???", "x", "---"]));
    expect(events.every((e) => e.parserId === "generic")).toBe(true);
  });
});

describe("parser registry - negative match guards", () => {
  it("key-value does not win on random text with single =", () => {
    const events = parseLines(toRawLines(["hello world foo=bar"]));
    expect(events[0].parserId).not.toBe("key-value");
  });

  it("json does not claim invalid JSON", () => {
    const events = parseLines(toRawLines(['{"level":"error","msg":"broken quote}']));
    expect(events[0].parserId).not.toBe("json");
  });
});

describe("parser registry - partial parse", () => {
  it("keeps outer parse with warning when ISO + malformed JSON", () => {
    const events = parseLines(toRawLines(['2024-03-08T14:02:12Z {"level":"error","msg":"boom"']));
    expect(events[0].parserId).toBe("iso-text");
    expect(events[0].parseWarnings?.join(" ")).toContain("JSON parse failed");
  });
});

describe("parser registry - malformed input resilience", () => {
  it("never crashes on malformed inputs", () => {
    const malformed = [
      '{"level":"error","msg":"broken quote}',
      "2024-03-08T14:02:12 broken ts",
      "level=error msg=\"oops service=api",
      "api ERROR \u0000\u0001 weird control chars",
      `{"level":"info","msg":"${"x".repeat(5000)}"}`,
      "1710022334 service=api level=info msg=epoch seconds",
      "1710022334000 service=api level=info msg=epoch millis",
    ];
    const events = parseLines(toRawLines(malformed));
    expect(events.length).toBe(7);
    for (const event of events) {
      expect(event.message.length).toBeGreaterThan(0);
      expect(event.parserId).toBeDefined();
    }
  });

  it("skips empty and whitespace-only lines", () => {
    const raw = [
      { line: "", lineNumber: 1, source: "file" as const },
      { line: "   ", lineNumber: 2, source: "file" as const },
      { line: "2024-03-08T14:02:00Z valid", lineNumber: 3, source: "file" as const },
    ];
    const events = parseLines(raw);
    expect(events).toHaveLength(1);
  });

  it("records parser metrics", () => {
    resetParserMetrics();
    parseLines(toRawLines([LOG_FIXTURES.json]))[0];
    const metrics = getParserMetrics();
    expect(Object.values(metrics.parserHits).reduce((a, b) => a + b, 0)).toBe(1);
  });
});
