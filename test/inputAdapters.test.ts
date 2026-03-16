import { describe, expect, it } from "vitest";
import { parseLines } from "../src/utils/parser.js";
import {
  getAdapterMetrics,
  getAdapterRegistrySnapshot,
  ingestWithAdapters,
  resetAdapterRegistryForTests,
  selectAdapter,
} from "../src/utils/inputAdapters/index.js";

describe("input adapter registry", () => {
  it("selects adapters deterministically by explicit order", () => {
    resetAdapterRegistryForTests();
    const input = {
      content: JSON.stringify({ log: { entries: [] } }),
      context: { path: "capture.har", sourceKind: "file" as const },
    };
    const first = selectAdapter(input);
    const second = selectAdapter(input);
    expect(first.adapter?.adapterId).toBe("har");
    expect(second.adapter?.adapterId).toBe("har");
    expect(getAdapterRegistrySnapshot()).toEqual(["har", "pcap", "text-log"]);
  });

  it("routes text logs through text-log adapter and parser registry", () => {
    resetAdapterRegistryForTests();
    const input = {
      content: [
        "2024-03-08T14:02:12Z service=api level=error msg=\"boom\"",
        "Mar 14 01:04:31 host syslogd[540]: ASL Sender Statistics",
      ].join("\n"),
      context: { path: "app.log", sourceKind: "file" as const },
    };
    const result = ingestWithAdapters(input);
    expect(result.adapterId).toBe("text-log");
    expect(result.kind).toBe("text-lines");
    expect(result.lines?.length).toBe(2);
    expect(result.events.length).toBe(2);
    expect(result.events[0].type).toBe("log");
    expect(result.events[0].parserId).toBeDefined();
    expect(result.events[0].diagnostics?.parser?.parserId).toBeDefined();
    expect(result.events[0].diagnostics?.adapter?.adapterId).toBe("text-log");
  });

  it("converts HAR entries into canonical HTTP events", () => {
    resetAdapterRegistryForTests();
    const har = {
      log: {
        entries: [
          {
            startedDateTime: "2024-03-08T14:02:12.123Z",
            time: 42.4,
            request: { method: "GET", url: "https://api.example.com/v1/health", httpVersion: "HTTP/1.1" },
            response: { status: 200, statusText: "OK" },
          },
        ],
      },
    };
    const result = ingestWithAdapters({
      content: JSON.stringify(har),
      context: { path: "session.har", sourceKind: "file" as const },
    });
    expect(result.adapterId).toBe("har");
    expect(result.kind).toBe("canonical-events");
    expect(result.events.length).toBe(1);
    expect(result.events[0].type).toBe("http");
    expect(result.events[0].method).toBe("GET");
    expect(result.events[0].statusCode).toBe(200);
    expect(result.events[0].latencyMs).toBe(42.4);
    expect(result.events[0].diagnostics?.adapter?.adapterId).toBe("har");
  });

  it("degrades safely on malformed HAR", () => {
    resetAdapterRegistryForTests();
    const result = ingestWithAdapters({
      content: "{\"log\":{\"entries\":[",
      context: { path: "broken.har", sourceKind: "file" as const },
    });
    expect(result.adapterId).toBe("har");
    expect(result.events).toEqual([]);
    expect((result.warnings ?? []).join(" ")).toContain("HAR JSON parse failed");
  });

  it("rejects unsupported binary source safely", () => {
    resetAdapterRegistryForTests();
    const weirdBinary = Buffer.from([0x00, 0x81, 0x88, 0x92, 0xff, 0xaa, 0xbb, 0xcc]);
    const result = ingestWithAdapters({
      content: weirdBinary,
      context: { path: "mystery.bin", sourceKind: "file" as const },
    });
    expect(result.kind).toBe("unsupported");
    expect(result.adapterId).toBe("unsupported");
    expect(result.events.length).toBe(0);
  });

  it("supports PCAP scaffold without breaking pipeline", () => {
    resetAdapterRegistryForTests();
    const pcapMagic = Buffer.from([0xa1, 0xb2, 0xc3, 0xd4, 0x00, 0x00, 0x00, 0x00]);
    const result = ingestWithAdapters({
      content: pcapMagic,
      context: { path: "traffic.pcap", sourceKind: "file" as const },
    });
    expect(result.adapterId).toBe("pcap");
    expect(result.kind).toBe("canonical-events");
    expect(result.events).toEqual([]);
    expect((result.warnings ?? []).join(" ")).toContain("scaffold");
  });

  it("keeps parseLines behavior stable", () => {
    const events = parseLines([{ line: "2024-03-08T14:02:12Z error: failed", lineNumber: 1 }]);
    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe("error");
  });

  it("records adapter metrics hooks", () => {
    resetAdapterRegistryForTests();
    ingestWithAdapters({
      content: "2024-03-08T14:02:12Z info started",
      context: { path: "app.log", sourceKind: "file" as const },
    });
    const metrics = getAdapterMetrics();
    expect(metrics.adapterHits["text-log"]).toBe(1);
    expect(metrics.unsupportedHits).toBe(0);
  });
});

