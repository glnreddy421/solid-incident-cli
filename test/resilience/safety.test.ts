import { describe, expect, it } from "vitest";
import { parseLines } from "../../src/utils/parser.js";
import { ingestWithAdapters } from "../../src/utils/inputAdapters/registry.js";
import { loadInput } from "../../src/cli/input.js";
import { analyzeLocally } from "../../src/engine/analysisEngine.js";
import { resetAdapterRegistryForTests } from "../../src/utils/inputAdapters/index.js";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { toRawLines } from "../fixtures/helpers.js";

describe("resilience - extremely long lines", () => {
  it("does not crash on very long lines", () => {
    const long = "x".repeat(100_000);
    const events = parseLines(toRawLines([`2024-03-08T14:02:12Z msg="${long}"`]));
    expect(events.length).toBe(1);
    expect(events[0].message?.length).toBeGreaterThan(0);
  });
});

describe("resilience - repeated malformed lines", () => {
  it("handles many malformed lines", () => {
    const malformed = Array.from({ length: 50 }, (_, i) => `broken line ${i} {"incomplete":`);
    const events = parseLines(toRawLines(malformed));
    expect(events.length).toBe(50);
    events.forEach((e) => expect(e.parserId).toBeDefined());
  });
});

describe("resilience - control characters", () => {
  it("handles control chars without crashing", () => {
    const events = parseLines(toRawLines(["api ERROR \u0000\u0001\u0002 weird"]));
    expect(events.length).toBe(1);
  });
});

describe("resilience - empty and whitespace files", () => {
  it("loadInput throws on empty file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "solid-res-"));
    const empty = join(dir, "empty.log");
    writeFileSync(empty, "", "utf8");
    await expect(loadInput([empty])).rejects.toThrow();
  });
});

describe("resilience - duplicate timestamps", () => {
  it("handles duplicate timestamps deterministically", () => {
    const raw = toRawLines([
      "2024-03-08T14:02:12Z api info: first",
      "2024-03-08T14:02:12Z api info: second",
      "2024-03-08T14:02:12Z api info: third",
    ]);
    const events = parseLines(raw);
    expect(events.length).toBe(3);
    expect(events.every((e) => e.timestamp === "2024-03-08T14:02:12Z")).toBe(true);
  });
});

describe("resilience - out-of-order timestamps", () => {
  it("sorts by timestamp correctly", () => {
    const raw = toRawLines([
      "2024-03-08T14:02:15Z event c",
      "2024-03-08T14:02:10Z event a",
      "2024-03-08T14:02:12Z event b",
    ]);
    const events = parseLines(raw);
    expect(events[0].message).toContain("a");
    expect(events[1].message).toContain("b");
    expect(events[2].message).toContain("c");
  });
});

describe("resilience - engine under hostile input", () => {
  it("engine produces structured output for messy input", () => {
    const messy = [
      "???",
      "2024-03-08T14:02:12Z api error: real error",
      '{"broken',
      "x",
    ];
    const result = analyzeLocally({
      rawLines: toRawLines(messy),
      inputSources: [{ kind: "file", name: "messy.log" }],
      mode: "text",
    });
    expect(result.assessment).toBeDefined();
    expect(result.timeline.length).toBeGreaterThan(0);
  });
});
