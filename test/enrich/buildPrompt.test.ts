import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { buildPrompt } from "../../src/enrich/prompting/buildPrompt.js";
import type { IncidentEnrichmentPayload } from "../../src/enrich/types.js";

const payload: IncidentEnrichmentPayload = {
  schemaVersion: "incident-enrichment.v1",
  generatedAt: new Date().toISOString(),
  source: { kind: "analysis-result", engineVersion: "1.0.0" },
  incident: { verdict: "INCIDENT DETECTED", severity: "high", confidence: 0.8, healthScore: 30 },
  rootCauseCandidates: [],
  affectedServices: [],
  signals: [],
  timeline: [],
  suggestedCauses: [],
  suggestedFixes: [],
  evidenceExcerpts: [],
  metadata: {
    ambiguityFlags: [],
    truncation: {
      timelineEntriesDropped: 0,
      signalsDropped: 0,
      candidatesDropped: 0,
      excerptsDropped: 0,
    },
  },
};

describe("buildPrompt", () => {
  it("switches by style and includes payload for all styles", async () => {
    const styles = ["briefing", "rca", "executive", "runbook", "star", "car", "debug", "questions"] as const;
    for (const style of styles) {
      const prompt = await buildPrompt({ style, payload });
      expect(prompt.userPrompt).toContain(`Style: ${style}`);
      expect(prompt.userPrompt).toContain('"schemaVersion": "incident-enrichment.v1"');
      expect(prompt.systemPrompt).toContain("interpretation and communication");
    }
  });

  it("supports prompt overrides from files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "solid-prompt-"));
    const systemPath = join(dir, "system.txt");
    const userPath = join(dir, "user.txt");
    writeFileSync(systemPath, "custom system");
    writeFileSync(userPath, "custom user");

    const prompt = await buildPrompt({
      style: "rca",
      payload,
      systemPromptFile: systemPath,
      promptFile: userPath,
    });
    expect(prompt.systemPrompt).toBe("custom system");
    expect(prompt.userPrompt).toBe("custom user");
  });
});
