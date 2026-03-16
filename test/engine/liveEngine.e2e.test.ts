import { appendFile, mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { startLiveAnalysis } from "../../src/core/live/liveAnalysisEngine.js";
import type { CanonicalEvent } from "../../src/utils/inputAdapters/types.js";

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

describe("live engine e2e", () => {
  it("start -> append -> getSnapshot -> stop produces structured output", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "solid-live-e2e-"));
    const fileA = path.join(dir, "a.log");
    await writeFile(fileA, "", "utf8");

    const controller = await startLiveAnalysis(
      [{ sourceId: "a", sourceName: "a.log", sourcePath: fileA, sourceType: "file" }],
      { fromStart: false, pollIntervalMs: 50 },
    );

    await appendFile(fileA, "2026-03-14T01:00:00Z api ERROR timeout\n", "utf8");
    await appendFile(fileA, "2026-03-14T01:00:01Z api WARN retry 1/3\n", "utf8");
    await appendFile(fileA, "2026-03-14T01:00:02Z api ERROR failed\n", "utf8");

    await waitFor(() => controller.getSnapshot().mergedTimeline.length >= 3);

    const snapshot = controller.getSnapshot();
    expect(snapshot.mergedTimeline.length).toBeGreaterThanOrEqual(3);
    expect(snapshot.correlatedGroups).toBeDefined();
    expect(snapshot.findings).toBeDefined();
    expect(snapshot.causalChains).toBeDefined();
    expect(snapshot.confidenceSummary).toBeDefined();
    expect(snapshot.diagnostics.ruleExecutionOrder.length).toBeGreaterThan(0);

    await controller.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it("stop is safe to call multiple times", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "solid-live-e2e-"));
    const fileA = path.join(dir, "x.log");
    await writeFile(fileA, "", "utf8");
    const controller = await startLiveAnalysis(
      [{ sourceId: "x", sourceName: "x.log", sourcePath: fileA, sourceType: "file" }],
      { fromStart: false, pollIntervalMs: 50 },
    );
    await controller.stop();
    await controller.stop();
    await controller.stop();
    await rm(dir, { recursive: true, force: true });
  });
});
