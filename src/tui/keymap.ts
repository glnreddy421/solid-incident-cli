import type { TuiPanelId } from "../contracts/index.js";

export interface KeyAction {
  key: string;
  description: string;
}

export const PANEL_ORDER: TuiPanelId[] = [
  "summary",
  "timeline",
  "trace-graph",
  "mindmap",
  "signals",
  "evidence",
  "ai-analysis",
  "reports",
  "diagnostics",
];

export const PANEL_LABELS: Record<TuiPanelId, string> = {
  summary: "Summary",
  timeline: "Timeline",
  "trace-graph": "Trace Graph",
  mindmap: "Mind Map",
  signals: "Signals",
  evidence: "Evidence",
  "ai-analysis": "AI Analysis",
  reports: "Reports",
  diagnostics: "Diagnostics",
};

export const KEYMAP: KeyAction[] = [
  { key: "1-9", description: "Switch panel" },
  { key: "tab", description: "Switch focus region" },
  { key: "/", description: "Set search query" },
  { key: "f", description: "Set filter" },
  { key: "j/k", description: "Scroll analysis down/up" },
  { key: "PgDn/PgUp", description: "Scroll one page down/up" },
  { key: "Home/End", description: "Jump to top/bottom" },
  { key: "t", description: "Jump to trigger event" },
  { key: "s", description: "Jump to strongest signal" },
  { key: "r", description: "Generate incident report" },
  { key: "c", description: "Generate RCA report" },
  { key: "i", description: "Generate interview-style STAR story" },
  { key: "T", description: "Generate technical timeline report" },
  { key: "e", description: "Export current analysis" },
  { key: "w", description: "Save session snapshot" },
  { key: "g", description: "Refresh AI reasoning" },
  { key: "a", description: "Open AI explanation panel" },
  { key: "u", description: "Manual live AI update" },
  { key: "p", description: "Pause/resume live view" },
  { key: "F", description: "Finalize stream snapshot" },
  { key: "x", description: "Clear panel/search/filter state" },
  { key: "?", description: "Toggle help overlay" },
  { key: "q", description: "Quit TUI" },
];

