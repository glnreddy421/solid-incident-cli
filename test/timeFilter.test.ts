import { describe, it, expect } from "vitest";
import { filterByTimeWindow } from "../src/utils/timeFilter.js";

const line = (ts: string, num: number) => ({
  line: `${ts} log line ${num}`,
  lineNumber: num,
  source: "file" as const,
});

describe("filterByTimeWindow", () => {
  it("returns empty for empty input", () => {
    expect(filterByTimeWindow([], {})).toEqual([]);
  });

  it("returns all when no filter options", () => {
    const lines = [
      line("2024-03-08T14:02:00Z", 1),
      line("2024-03-08T14:02:10Z", 2),
    ];
    expect(filterByTimeWindow(lines, {})).toHaveLength(2);
  });

  it("applies --tail to keep last N lines", () => {
    const lines = [
      line("2024-03-08T14:02:00Z", 1),
      line("2024-03-08T14:02:01Z", 2),
      line("2024-03-08T14:02:02Z", 3),
    ];
    const result = filterByTimeWindow(lines, { tail: 2 });
    expect(result).toHaveLength(2);
    expect(result[0].lineNumber).toBe(2);
    expect(result[1].lineNumber).toBe(3);
  });

  it("parses --since 5m and filters by time window", () => {
    const base = "2024-03-08T14:00:00Z";
    const lines = [
      line("2024-03-08T13:54:00Z", 1), // 6 min before
      line("2024-03-08T13:56:00Z", 2), // 4 min before
      line("2024-03-08T14:00:00Z", 3), // at ref (latest)
    ];
    const result = filterByTimeWindow(lines, { since: "5m" });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some((r) => r.lineNumber === 1)).toBe(false);
  });

  it("throws on invalid --since format", () => {
    const lines = [line("2024-03-08T14:00:00Z", 1)];
    expect(() => filterByTimeWindow(lines, { since: "invalid" })).toThrow(/Invalid --since/);
  });
});
