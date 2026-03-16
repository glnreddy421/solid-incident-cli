import { appendFile, mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { startLiveAnalysis } from "../src/core/live/liveAnalysisEngine.js";
import type { CanonicalEvent } from "../src/utils/inputAdapters/types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error("waitFor timeout");
}

describe("live multi-source ingestion + correlation", () => {
  it("tails multiple files concurrently and preserves source metadata", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "solid-live-"));
    const fileA = path.join(dir, "a.log");
    const fileB = path.join(dir, "b.log");
    await writeFile(fileA, "seed-a\n", "utf8");
    await writeFile(fileB, "seed-b\n", "utf8");

    const events: CanonicalEvent[] = [];
    const controller = await startLiveAnalysis(
      [
        { sourceId: "src-a", sourceName: "a.log", sourcePath: fileA, sourceType: "file" },
        { sourceId: "src-b", sourceName: "b.log", sourcePath: fileB, sourceType: "file" },
      ],
      {
        fromStart: false,
        pollIntervalMs: 50,
        onEvent: (event) => events.push(event),
      },
    );

    await appendFile(fileA, "2026-03-14T01:00:00Z api ERROR timeout while calling auth\n", "utf8");
    await appendFile(fileB, "2026-03-14T01:00:01Z gateway ERROR 503 upstream timeout\n", "utf8");

    await waitFor(() => events.length >= 2);
    await controller.stop();

    expect(events.some((event) => event.sourceId === "src-a")).toBe(true);
    expect(events.some((event) => event.sourceId === "src-b")).toBe(true);
    expect(events.every((event) => event.sourcePath === fileA || event.sourcePath === fileB)).toBe(true);

    await rm(dir, { recursive: true, force: true });
  });

  it("buffers partial lines until newline is completed", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "solid-live-"));
    const fileA = path.join(dir, "partial.log");
    await writeFile(fileA, "", "utf8");
    const events: CanonicalEvent[] = [];
    const controller = await startLiveAnalysis(
      [{ sourceId: "src-partial", sourceName: "partial.log", sourcePath: fileA, sourceType: "file" }],
      { fromStart: false, pollIntervalMs: 50, onEvent: (event) => events.push(event) },
    );

    await appendFile(fileA, "2026-03-14T01:00:00Z worker WARN retrying", "utf8");
    await sleep(150);
    expect(events.length).toBe(0);

    await appendFile(fileA, " attempt 1/5\n", "utf8");
    await waitFor(() => events.length === 1);
    await controller.stop();
    expect(events[0].message?.toLowerCase()).toContain("retry");

    await rm(dir, { recursive: true, force: true });
  });

  it("produces inferred findings for single-source chain with conservative confidence", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "solid-live-"));
    const fileA = path.join(dir, "single.log");
    await writeFile(fileA, "", "utf8");

    const controller = await startLiveAnalysis(
      [{ sourceId: "single", sourceName: "single.log", sourcePath: fileA, sourceType: "file" }],
      { fromStart: false, pollIntervalMs: 50 },
    );
    await appendFile(fileA, "2026-03-14T01:00:00Z api ERROR timeout while calling db\n", "utf8");
    await appendFile(fileA, "2026-03-14T01:00:01Z api WARN retry attempt 1/3\n", "utf8");
    await appendFile(fileA, "2026-03-14T01:00:02Z api ERROR failed dependency request\n", "utf8");
    await waitFor(() => controller.getSnapshot().activeChains.length >= 1);
    const snapshot = controller.getSnapshot();
    await controller.stop();

    expect(snapshot.activeChains[0].corroboration).toBe("single-source-inferred");
    expect(snapshot.activeChains[0].confidence).toBeLessThanOrEqual(0.7);

    await rm(dir, { recursive: true, force: true });
  });

  it("increases confidence with multi-source corroboration", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "solid-live-"));
    const fileA = path.join(dir, "auth.log");
    const fileB = path.join(dir, "gateway.log");
    await writeFile(fileA, "", "utf8");
    await writeFile(fileB, "", "utf8");

    const controller = await startLiveAnalysis(
      [
        { sourceId: "auth", sourceName: "auth.log", sourcePath: fileA, sourceType: "file" },
        { sourceId: "gw", sourceName: "gateway.log", sourcePath: fileB, sourceType: "file" },
      ],
      { fromStart: false, pollIntervalMs: 50 },
    );
    await appendFile(fileA, "2026-03-14T01:00:00Z auth ERROR timeout calling postgres\n", "utf8");
    await appendFile(fileA, "2026-03-14T01:00:01Z auth WARN retry attempt 1/3\n", "utf8");
    await appendFile(fileB, "2026-03-14T01:00:02Z gateway ERROR 503 upstream timeout\n", "utf8");
    await appendFile(fileB, "2026-03-14T01:00:03Z gateway ERROR failed user request\n", "utf8");
    await waitFor(() => controller.getSnapshot().findings.some((finding) => finding.corroboration === "multi-source-corroborated"));
    const snapshot = controller.getSnapshot();
    await controller.stop();

    const multi = snapshot.findings.find((finding) => finding.corroboration === "multi-source-corroborated");
    expect(multi).toBeDefined();
    expect((multi?.confidence ?? 0)).toBeGreaterThan(0.75);

    await rm(dir, { recursive: true, force: true });
  });

  it("handles truncation safely and stops cleanly", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "solid-live-"));
    const fileA = path.join(dir, "rotate.log");
    await writeFile(fileA, "2026-03-14T01:00:00Z api INFO startup\n", "utf8");

    const warnings: string[] = [];
    const events: CanonicalEvent[] = [];
    const controller = await startLiveAnalysis(
      [{ sourceId: "rot", sourceName: "rotate.log", sourcePath: fileA, sourceType: "file" }],
      { fromStart: false, pollIntervalMs: 50, onWarning: (warning) => warnings.push(warning), onEvent: (event) => events.push(event) },
    );

    await writeFile(fileA, "2026-03-14T01:00:01Z api INFO truncated and rewritten\n", "utf8");
    await appendFile(fileA, "2026-03-14T01:00:02Z api ERROR timeout after rotate\n", "utf8");
    await waitFor(() => events.length >= 1);
    await sleep(150);
    await controller.stop();

    expect(events.length).toBeGreaterThanOrEqual(1);

    // repeated stop should be safe
    await controller.stop();
    await rm(dir, { recursive: true, force: true });
  });
});

