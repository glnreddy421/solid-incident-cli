import { describe, expect, it } from "vitest";
import { RollingEventWindow } from "../../src/core/correlation/rollingWindow.js";
import { makeCanonicalEvent } from "../fixtures/helpers.js";

describe("rolling window", () => {
  it("events enter the window", () => {
    const window = new RollingEventWindow(60_000);
    window.add(makeCanonicalEvent({ id: "e1", timestamp: "2026-03-14T01:00:00Z", message: "a" }));
    window.add(makeCanonicalEvent({ id: "e2", timestamp: "2026-03-14T01:00:01Z", message: "b" }));
    const all = window.getAll();
    expect(all.length).toBe(2);
  });

  it("old events age out deterministically", () => {
    const window = new RollingEventWindow(2_000);
    window.add(makeCanonicalEvent({ id: "o1", timestamp: "2026-03-14T01:00:00Z", message: "old" }));
    window.add(makeCanonicalEvent({ id: "o2", timestamp: "2026-03-14T01:00:01Z", message: "mid" }));
    window.add(makeCanonicalEvent({ id: "o3", timestamp: "2026-03-14T01:00:20Z", message: "new" }));
    const all = window.getAll();
    expect(all.length).toBe(1);
    expect(all[0].id).toBe("o3");
  });

  it("ordering remains stable by timestamp", () => {
    const window = new RollingEventWindow(60_000);
    window.add(makeCanonicalEvent({ id: "a", timestamp: "2026-03-14T01:00:02Z", message: "c" }));
    window.add(makeCanonicalEvent({ id: "b", timestamp: "2026-03-14T01:00:00Z", message: "a" }));
    window.add(makeCanonicalEvent({ id: "c", timestamp: "2026-03-14T01:00:01Z", message: "b" }));
    const all = window.getAll();
    const sorted = [...all].sort((x, y) => (x.timestamp ?? "").localeCompare(y.timestamp ?? ""));
    expect(sorted[0].id).toBe("b");
    expect(sorted[1].id).toBe("c");
    expect(sorted[2].id).toBe("a");
  });
});
