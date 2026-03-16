import { describe, expect, it } from "vitest";
import { ingestWithAdapters } from "../../src/utils/inputAdapters/registry.js";
import { resetAdapterRegistryForTests } from "../../src/utils/inputAdapters/index.js";
import type { CanonicalEvent } from "../../src/utils/inputAdapters/types.js";

describe("canonical event contract - core fields", () => {
  it("log events contain type and source", () => {
    resetAdapterRegistryForTests();
    const result = ingestWithAdapters({
      content: "2024-03-08T14:02:12Z api info: started",
      context: { path: "app.log", sourceKind: "file" as const },
    });
    const event = result.events[0] as CanonicalEvent;
    expect(event.type).toBe("log");
    expect(event.source).toBeDefined();
  });

  it("HTTP events contain type http", () => {
    resetAdapterRegistryForTests();
    const har = { log: { entries: [{ startedDateTime: "2024-03-08T14:02:12Z", request: { method: "GET", url: "https://x" }, response: { status: 200 } }] } };
    const result = ingestWithAdapters({
      content: JSON.stringify(har),
      context: { path: "x.har", sourceKind: "file" as const },
    });
    expect(result.events[0].type).toBe("http");
  });
});

describe("canonical event contract - diagnostics", () => {
  it("parser diagnostics preserved on log events", () => {
    resetAdapterRegistryForTests();
    const result = ingestWithAdapters({
      content: "2024-03-08T14:02:12Z service=api level=error msg=\"boom\"",
      context: { path: "app.log", sourceKind: "file" as const },
    });
    const event = result.events[0] as CanonicalEvent;
    expect(event.parserId).toBeDefined();
    expect(event.parseConfidence).toBeDefined();
    expect(event.parseReasons).toBeDefined();
    expect(event.diagnostics?.parser?.parserId).toBeDefined();
  });

  it("adapter diagnostics preserved", () => {
    resetAdapterRegistryForTests();
    const result = ingestWithAdapters({
      content: "2024-03-08T14:02:12Z info started",
      context: { path: "app.log", sourceKind: "file" as const },
    });
    const event = result.events[0] as CanonicalEvent;
    expect(event.adapterId).toBe("text-log");
    expect(event.adapterConfidence).toBeDefined();
    expect(event.diagnostics?.adapter?.adapterId).toBe("text-log");
  });
});

describe("canonical event contract - serializability", () => {
  it("events are JSON serializable", () => {
    resetAdapterRegistryForTests();
    const result = ingestWithAdapters({
      content: "2024-03-08T14:02:12Z api info: test",
      context: { path: "app.log", sourceKind: "file" as const },
    });
    const event = result.events[0];
    expect(() => JSON.stringify(event)).not.toThrow();
    const roundtrip = JSON.parse(JSON.stringify(event));
    expect(roundtrip.type).toBe(event.type);
    expect(roundtrip.message).toBe(event.message);
  });
});
