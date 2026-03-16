import { describe, expect, it } from "vitest";
import {
  getAdapterMetrics,
  getAdapterRegistrySnapshot,
  ingestWithAdapters,
  resetAdapterRegistryForTests,
  selectAdapter,
} from "../../src/utils/inputAdapters/index.js";
import { loadInput } from "../../src/cli/input.js";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("adapter registry - selection", () => {
  it("adapter selection is deterministic", () => {
    resetAdapterRegistryForTests();
    const input = {
      content: JSON.stringify({ log: { entries: [] } }),
      context: { path: "capture.har", sourceKind: "file" as const },
    };
    expect(selectAdapter(input).adapter?.adapterId).toBe("har");
    expect(selectAdapter(input).adapter?.adapterId).toBe("har");
  });

  it("registry order is har, pcap, text-log", () => {
    resetAdapterRegistryForTests();
    expect(getAdapterRegistrySnapshot()).toEqual(["har", "pcap", "text-log"]);
  });
});

describe("adapter registry - source routing", () => {
  it("text-log routes .log files", () => {
    resetAdapterRegistryForTests();
    const result = ingestWithAdapters({
      content: "2024-03-08T14:02:12Z info started",
      context: { path: "app.log", sourceKind: "file" as const },
    });
    expect(result.adapterId).toBe("text-log");
    expect(result.kind).toBe("text-lines");
  });

  it("har routes .har files", () => {
    resetAdapterRegistryForTests();
    const result = ingestWithAdapters({
      content: JSON.stringify({ log: { entries: [] } }),
      context: { path: "session.har", sourceKind: "file" as const },
    });
    expect(result.adapterId).toBe("har");
    expect(result.kind).toBe("canonical-events");
  });

  it("pcap routes .pcap files", () => {
    resetAdapterRegistryForTests();
    const pcapMagic = Buffer.from([0xa1, 0xb2, 0xc3, 0xd4, 0x00, 0x00, 0x00, 0x00]);
    const result = ingestWithAdapters({
      content: pcapMagic,
      context: { path: "traffic.pcap", sourceKind: "file" as const },
    });
    expect(result.adapterId).toBe("pcap");
    expect(result.kind).toBe("canonical-events");
  });
});

describe("adapter registry - text-log feeds parser", () => {
  it("text-log adapter output goes through parser registry", () => {
    resetAdapterRegistryForTests();
    const result = ingestWithAdapters({
      content: [
        "2024-03-08T14:02:12Z service=api level=error msg=\"boom\"",
        "Mar 14 01:04:31 host syslogd[540]: ASL Sender Statistics",
      ].join("\n"),
      context: { path: "app.log", sourceKind: "file" as const },
    });
    expect(result.events.length).toBe(2);
    expect(result.events[0].parserId).toBeDefined();
    expect(result.events[0].type).toBe("log");
  });
});

describe("adapter registry - HAR", () => {
  it("valid HAR produces HTTP canonical events", () => {
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
    expect(result.events[0].type).toBe("http");
    expect(result.events[0].method).toBe("GET");
    expect(result.events[0].statusCode).toBe(200);
    expect(result.events[0].latencyMs).toBe(42.4);
  });

  it("malformed HAR degrades safely with warnings", () => {
    resetAdapterRegistryForTests();
    const result = ingestWithAdapters({
      content: "{\"log\":{\"entries\":[",
      context: { path: "broken.har", sourceKind: "file" as const },
    });
    expect(result.adapterId).toBe("har");
    expect(result.events).toEqual([]);
    expect((result.warnings ?? []).join(" ")).toContain("HAR JSON parse failed");
  });
});

describe("adapter registry - PCAP scaffold", () => {
  it("PCAP scaffold returns empty events with warnings", () => {
    resetAdapterRegistryForTests();
    const pcapMagic = Buffer.from([0xa1, 0xb2, 0xc3, 0xd4, 0x00, 0x00, 0x00, 0x00]);
    const result = ingestWithAdapters({
      content: pcapMagic,
      context: { path: "traffic.pcap", sourceKind: "file" as const },
    });
    expect(result.adapterId).toBe("pcap");
    expect(result.events).toEqual([]);
    expect((result.warnings ?? []).join(" ")).toContain("scaffold");
  });
});

describe("adapter registry - unsupported input", () => {
  it("unknown binary rejected safely", () => {
    resetAdapterRegistryForTests();
    const weirdBinary = Buffer.from([0x00, 0x81, 0x88, 0x92, 0xff]);
    const result = ingestWithAdapters({
      content: weirdBinary,
      context: { path: "mystery.bin", sourceKind: "file" as const },
    });
    expect(result.kind).toBe("unsupported");
    expect(result.events.length).toBe(0);
  });
});

describe("adapter registry - multiple sources via loadInput", () => {
  it("multiple files ingested with source metadata preserved", async () => {
    const dir = mkdtempSync(join(tmpdir(), "solid-multi-"));
    const fileA = join(dir, "a.log");
    const fileB = join(dir, "b.log");
    writeFileSync(fileA, "2024-03-08T14:02:12Z api info: from a\n", "utf8");
    writeFileSync(fileB, "2024-03-08T14:02:13Z gateway info: from b\n", "utf8");

    const result = await loadInput([fileA, fileB]);
    expect(result.lines.length).toBe(2);
    expect(result.sources).toHaveLength(2);
    expect(result.lines.some((l) => l.sourceName?.includes("a.log"))).toBe(true);
    expect(result.lines.some((l) => l.sourceName?.includes("b.log"))).toBe(true);
  });
});
