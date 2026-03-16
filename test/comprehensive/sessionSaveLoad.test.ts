import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { analyzeLocally } from "../../src/engine/analysisEngine.js";
import { deleteSession, getSession, listSessions, saveSession } from "../../src/storage/sessionStore.js";
import { toRawLines } from "../fixtures/helpers.js";

const originalHome = process.env.HOME;

describe("session save/load round-trip", () => {
  let sessionsDir: string;

  beforeAll(() => {
    sessionsDir = mkdtempSync(join(tmpdir(), "solid-sessions-"));
    process.env.HOME = sessionsDir;
  });

  afterAll(() => {
    process.env.HOME = originalHome;
  });

  it("saveSession persists and getSession retrieves", async () => {
    const result = analyzeLocally({
      rawLines: toRawLines([
        "2024-03-08T14:02:12Z api error: connection refused",
        "2024-03-08T14:02:13Z api warn: retry 1/3",
      ]),
      inputSources: [{ kind: "file", name: "test.log" }],
      mode: "text",
    });
    const saved = await saveSession(result, "Test incident");
    expect(saved.sessionId).toBeDefined();
    expect(saved.title).toBe("Test incident");

    const loaded = await getSession(saved.sessionId);
    expect(loaded).not.toBeNull();
    expect(loaded?.sessionId).toBe(saved.sessionId);
    expect(loaded?.schemaSnapshot).toBeDefined();
    expect(loaded?.schemaSnapshot?.timeline?.length).toBe(2);
    expect(loaded?.schemaSnapshot?.assessment?.verdict).toBeDefined();
  });

  it("listSessions returns saved session", async () => {
    const result = analyzeLocally({
      rawLines: toRawLines(["2024-03-08T14:02:12Z info started"]),
      inputSources: [{ kind: "file", name: "x.log" }],
      mode: "text",
    });
    const saved = await saveSession(result);
    const sessions = await listSessions();
    expect(sessions.some((s) => s.sessionId === saved.sessionId)).toBe(true);
  });

  it("deleteSession removes session", async () => {
    const result = analyzeLocally({
      rawLines: toRawLines(["2024-03-08T14:02:12Z info x"]),
      inputSources: [{ kind: "file", name: "y.log" }],
      mode: "text",
    });
    const saved = await saveSession(result);
    const deleted = await deleteSession(saved.sessionId);
    expect(deleted).toBe(true);
    const loaded = await getSession(saved.sessionId);
    expect(loaded).toBeNull();
  });
});
