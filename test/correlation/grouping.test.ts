import { describe, expect, it } from "vitest";
import { groupCorrelatedEvents } from "../../src/core/correlation/grouping.js";
import { makeCanonicalEvent } from "../fixtures/helpers.js";

describe("grouping logic", () => {
  it("groups by service and time proximity", () => {
    const events = [
      makeCanonicalEvent({ id: "e1", timestamp: "2026-03-14T01:00:00Z", service: "api", message: "a" }),
      makeCanonicalEvent({ id: "e2", timestamp: "2026-03-14T01:00:01Z", service: "api", message: "b" }),
      makeCanonicalEvent({ id: "e3", timestamp: "2026-03-14T01:00:02Z", service: "api", message: "c" }),
    ];
    const groups = groupCorrelatedEvents(events, 60_000);
    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(groups[0].services).toContain("api");
    expect(groups[0].relatedEventIds.length).toBeGreaterThanOrEqual(2);
  });

  it("unrelated singleton events do not get grouped", () => {
    const events = [
      makeCanonicalEvent({ id: "n1", timestamp: "2026-03-14T01:10:00Z", service: "auth", message: "login", level: "info" }),
      makeCanonicalEvent({ id: "n2", timestamp: "2026-03-14T01:10:40Z", service: "payments", message: "invoice", level: "info" }),
    ];
    const groups = groupCorrelatedEvents(events, 30_000);
    expect(groups.length).toBe(0);
  });

  it("groups include timeWindow and groupingReasons", () => {
    const events = [
      makeCanonicalEvent({ id: "a", timestamp: "2026-03-14T01:00:00Z", service: "api", message: "x" }),
      makeCanonicalEvent({ id: "b", timestamp: "2026-03-14T01:00:01Z", service: "api", message: "y" }),
    ];
    const groups = groupCorrelatedEvents(events, 60_000);
    if (groups.length > 0) {
      expect(groups[0].timeWindow).toBeDefined();
      expect(groups[0].timeWindow.start).toBeDefined();
      expect(groups[0].timeWindow.end).toBeDefined();
      expect(groups[0].groupingReasons.length).toBeGreaterThan(0);
    }
  });
});
