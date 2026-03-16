import { describe, expect, it } from "vitest";
import { classifyStrength, scoreConfidence } from "../../src/core/correlation/confidence.js";
import { makeCanonicalEvent } from "../fixtures/helpers.js";

describe("confidence scoring", () => {
  it("confidence increases with more supporting events", () => {
    const few = [makeCanonicalEvent({ id: "a", timestamp: "2026-03-14T01:00:00Z", message: "x" })];
    const many = Array.from({ length: 10 }, (_, i) =>
      makeCanonicalEvent({ id: `e${i}`, timestamp: `2026-03-14T01:00:0${i}Z`, message: "x" }),
    );
    const scoreFew = scoreConfidence({ events: few });
    const scoreMany = scoreConfidence({ events: many });
    expect(scoreMany.confidence).toBeGreaterThanOrEqual(scoreFew.confidence);
  });

  it("confidence increases with source diversity", () => {
    const single = [
      makeCanonicalEvent({ id: "a", timestamp: "2026-03-14T01:00:00Z", sourceId: "s1", message: "x" }),
      makeCanonicalEvent({ id: "b", timestamp: "2026-03-14T01:00:01Z", sourceId: "s1", message: "y" }),
    ];
    const multi = [
      makeCanonicalEvent({ id: "a", timestamp: "2026-03-14T01:00:00Z", sourceId: "s1", message: "x" }),
      makeCanonicalEvent({ id: "b", timestamp: "2026-03-14T01:00:01Z", sourceId: "s2", message: "y" }),
    ];
    const scoreSingle = scoreConfidence({ events: single });
    const scoreMulti = scoreConfidence({ events: multi });
    expect(scoreMulti.sourceDiversity).toBeGreaterThan(scoreSingle.sourceDiversity);
  });

  it("ambiguity penalty reduces confidence", () => {
    const events = [makeCanonicalEvent({ id: "a", timestamp: "2026-03-14T01:00:00Z", message: "x" })];
    const lowPenalty = scoreConfidence({ events, ambiguityPenalty: 0.05 });
    const highPenalty = scoreConfidence({ events, ambiguityPenalty: 0.2 });
    expect(highPenalty.confidence).toBeLessThan(lowPenalty.confidence);
  });
});

describe("strength classification", () => {
  it("single source yields single-source-inferred", () => {
    expect(classifyStrength(0.8, 1)).toBe("single-source-inferred");
  });

  it("multi source with high confidence yields high-confidence-cross-source", () => {
    expect(classifyStrength(0.85, 2)).toBe("high-confidence-cross-source");
  });

  it("multi source with moderate confidence yields multi-source-corroborated", () => {
    expect(classifyStrength(0.7, 2)).toBe("multi-source-corroborated");
  });
});
