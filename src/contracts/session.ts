import type { AnalysisResult, AppMode, InputSource, AiReport } from "./model.js";

export interface SessionRecord {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  mode: AppMode;
  inputSources: InputSource[];
  schemaSnapshot: AnalysisResult["schema"];
  backendResponse: AnalysisResult["ai"];
  title: string;
  tags: string[];
  status: "draft" | "finalized";
  warnings: string[];
  savedReports: AiReport[];
}

export interface SolidConfig {
  defaultMode: "auto" | "tui" | "text";
  defaultOutput: "text" | "json" | "markdown" | "html";
  aiEnabled: boolean;
  autoSaveSessions: boolean;
}

export const DEFAULT_CONFIG: SolidConfig = {
  defaultMode: "auto",
  defaultOutput: "text",
  aiEnabled: true,
  autoSaveSessions: true,
};

