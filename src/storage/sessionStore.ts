import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import type { AnalysisResult, SessionRecord } from "../contracts/index.js";

const SESSIONS_DIR = join(homedir(), ".solid", "sessions");

async function ensureStore(): Promise<void> {
  await mkdir(SESSIONS_DIR, { recursive: true });
}

function sessionPath(sessionId: string): string {
  return join(SESSIONS_DIR, `${sessionId}.json`);
}

function toSession(result: AnalysisResult, name?: string): SessionRecord {
  const now = new Date().toISOString();
  const sessionId = randomUUID();
  return {
    sessionId,
    createdAt: now,
    updatedAt: now,
    mode: result.mode,
    inputSources: result.inputSources,
    schemaSnapshot: result.schema,
    backendResponse: result.ai,
    title: name ?? result.summary.incidentSummary.slice(0, 80) ?? "Untitled incident session",
    tags: [],
    status: "draft",
    warnings: result.diagnostics.warnings,
    savedReports: Object.values(result.ai.reports).filter(Boolean) as SessionRecord["savedReports"],
  };
}

export async function saveSession(result: AnalysisResult, name?: string): Promise<SessionRecord> {
  await ensureStore();
  const session = toSession(result, name);
  await writeFile(sessionPath(session.sessionId), JSON.stringify(session, null, 2), "utf8");
  return session;
}

export async function listSessions(): Promise<SessionRecord[]> {
  await ensureStore();
  const { readdir } = await import("fs/promises");
  const entries = await readdir(SESSIONS_DIR);
  const sessions: SessionRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const content = await readFile(join(SESSIONS_DIR, entry), "utf8");
      sessions.push(JSON.parse(content) as SessionRecord);
    } catch {
      // Skip malformed session files.
    }
  }
  return sessions.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getSession(sessionId: string): Promise<SessionRecord | null> {
  await ensureStore();
  try {
    const content = await readFile(sessionPath(sessionId), "utf8");
    return JSON.parse(content) as SessionRecord;
  } catch {
    return null;
  }
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  await ensureStore();
  try {
    await rm(sessionPath(sessionId));
    return true;
  } catch {
    return false;
  }
}

