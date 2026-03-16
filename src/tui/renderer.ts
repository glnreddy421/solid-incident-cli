import readline from "readline";
import type { AnalysisResult, TuiPanelId, TuiState } from "../contracts/index.js";
import { TuiInitError } from "../contracts/index.js";
import { KEYMAP, PANEL_LABELS, PANEL_ORDER } from "./keymap.js";
import { renderLayout } from "./layout.js";
import { deriveLiveHealth, type LiveModeState } from "./liveMode.js";
import { createTheme, paint, type TuiTheme } from "./theme.js";

export interface TuiActions {
  onGenerateIncidentReport: (result: AnalysisResult) => Promise<void>;
  onGenerateRcaReport: (result: AnalysisResult) => Promise<void>;
  onGenerateInterviewStory: (result: AnalysisResult) => Promise<void>;
  onGenerateTechnicalTimeline?: (result: AnalysisResult) => Promise<void>;
  onRefreshAi: (result: AnalysisResult) => Promise<void>;
  onSave: (result: AnalysisResult) => Promise<void>;
  onExport: (result: AnalysisResult) => Promise<void>;
  onFinalizeLive?: (result: AnalysisResult) => Promise<void>;
  onManualLiveAiUpdate?: (result: AnalysisResult) => Promise<void>;
}

export interface TuiRuntimeOptions {
  inspect?: boolean;
  intervalSeconds?: number;
  hideHeader?: boolean;
  skipSplash?: boolean;
  logLevel?: "error" | "warn" | "info" | "debug";
}

export interface LiveUpdateConfig {
  intervalSeconds: number;
  getResult: () => AnalysisResult;
  onQuit?: () => void | Promise<void>;
}

// Large ASCII art — used for splash / welcome screen
const SOLIDX_ART = [
  "  ____    ___   _      ___   ____    _  __",
  " / ___|  / _ \\ | |    |_ _| |  _ \\  \\ \\/ /",
  " \\___ \\ | | | || |     | |  | | | |  \\  / ",
  "  ___) || |_| || |___  | |  | |_| |  /  \\ ",
  " |____/  \\___/ |_____|___|  |____/  /_/\\_\\",
];


function renderSplash(theme: TuiTheme): void {
  const cols = process.stdout.columns ?? 80;
  const artWidth = Math.max(...SOLIDX_ART.map((l) => l.length));
  const centerOffset = Math.max(0, Math.floor((cols - artWidth) / 2));
  const indent = " ".repeat(centerOffset);

  process.stdout.write("\x1Bc\n\n\n");
  for (const line of SOLIDX_ART) {
    process.stdout.write(`${indent}${paint(theme, line, theme.bold, theme.amber)}\n`);
  }
  process.stdout.write("\n");
  const tagline = "Incident Investigation Console";
  const tagIndent = " ".repeat(Math.max(0, Math.floor((cols - tagline.length) / 2)));
  process.stdout.write(`${tagIndent}${paint(theme, tagline, theme.amber)}\n`);
  process.stdout.write("\n");
  const sub = "Analyzing logs...";
  const subIndent = " ".repeat(Math.max(0, Math.floor((cols - sub.length) / 2)));
  process.stdout.write(`${subIndent}${paint(theme, sub, theme.muted)}\n`);
  process.stdout.write("\n");
}

export async function runWelcome(version: string): Promise<void> {
  const theme = createTheme();
  const cols  = process.stdout.columns ?? 80;
  const artWidth = Math.max(...SOLIDX_ART.map((l) => l.length));
  const artIndent = " ".repeat(Math.max(0, Math.floor((cols - artWidth) / 2)));

  const c = (s: string) => " ".repeat(Math.max(0, Math.floor((cols - s.length) / 2))) + s;

  process.stdout.write("\x1Bc\n\n");

  // Large amber logo
  for (const line of SOLIDX_ART) {
    process.stdout.write(`${artIndent}${paint(theme, line, theme.bold, theme.amber)}\n`);
  }

  process.stdout.write("\n");
  process.stdout.write(`${c("Incident Investigation Console")}\n`.replace(
    "Incident Investigation Console",
    paint(theme, "Incident Investigation Console", theme.amber),
  ));
  process.stdout.write(`${c(`v${version}`)}\n`.replace(
    `v${version}`,
    paint(theme, `v${version}`, theme.muted),
  ));

  process.stdout.write("\n");
  const divider = paint(theme, "─".repeat(Math.min(cols - 4, 60)), theme.muted);
  process.stdout.write(`  ${divider}\n\n`);

  process.stdout.write(`  ${paint(theme, "Provide logs to start investigating:", theme.bold)}\n\n`);

  const examples: [string, string][] = [
    ["solidx analyze app.log",                    "Analyze a log file  (opens TUI)"],
    ["solidx analyze a.log b.log",                "Analyze multiple files"],
    ["solidx analyze --live app.log",             "Live tail – TUI updates as logs stream"],
    ["cat incident.log | solidx analyze",         "Pipe logs from stdin"],
    ["kubectl logs deploy/api | solidx analyze",  "Stream from kubectl"],
    ["solidx analyze app.log --json",             "Output JSON  (CI/scripts)"],
    ["solidx analyze app.log --no-tui",           "Plain text output"],
  ];
  for (const [cmd, desc] of examples) {
    process.stdout.write(
      `    ${paint(theme, cmd.padEnd(46), theme.primary)}${paint(theme, desc, theme.muted)}\n`,
    );
  }

  process.stdout.write(`\n  ${divider}\n`);
  process.stdout.write(`\n  ${paint(theme, "solidx --help", theme.trigger)}${paint(theme, "  for all commands and flags", theme.muted)}\n\n`);
}

function renderHelp(): string[] {
  return [
    "Help Overlay",
    "----",
    ...PANEL_ORDER.map((panel, idx) => `${idx + 1}     ${PANEL_LABELS[panel]}`),
    "",
    ...KEYMAP.map((binding) => `${binding.key.padEnd(6)} ${binding.description}`),
    "",
    "Launch flags:",
    "--inspect --interval <sec> --hide-header --skip-splash --log-level <level>",
  ];
}

function colorizeSeverity(theme: TuiTheme, line: string): string {
  let next = line;
  next = next.replace(/\[(critical)\]/gi, (_m, s: string) => paint(theme, `[${s}]`, theme.bold, theme.danger));
  next = next.replace(/\[(error)\]/gi, (_m, s: string) => paint(theme, `[${s}]`, theme.danger));
  next = next.replace(/\[(warning|warn)\]/gi, (_m, s: string) => paint(theme, `[${s}]`, theme.warning));
  next = next.replace(/\[(info)\]/gi, (_m, s: string) => paint(theme, `[${s}]`, theme.info));
  next = next.replace(/\[(debug)\]/gi, (_m, s: string) => paint(theme, `[${s}]`, theme.muted));
  next = next.replace(/\bTRIGGER\b/g, paint(theme, "TRIGGER", theme.bold, theme.trigger));
  next = next.replace(/\bANOM\b/g, paint(theme, "ANOM", theme.warning));
  next = next.replace(/\bNO INCIDENT\b/g, paint(theme, "NO INCIDENT", theme.success, theme.bold));
  next = next.replace(/\bPOSSIBLE DEGRADATION\b/g, paint(theme, "POSSIBLE DEGRADATION", theme.warning, theme.bold));
  next = next.replace(/\bINCIDENT DETECTED\b/g, paint(theme, "INCIDENT DETECTED", theme.danger, theme.bold));
  next = next.replace(/\bINSUFFICIENT EVIDENCE\b/g, paint(theme, "INSUFFICIENT EVIDENCE", theme.muted, theme.bold));
  return next;
}

function colorizeStructure(theme: TuiTheme, line: string): string {
  const trimmed = line.trim();
  if (/^-- .+ --$/.test(trimmed)) return paint(theme, line, theme.bold, theme.accent);
  if (/^[-=─]{8,}$/.test(trimmed)) return paint(theme, line, theme.muted);
  const titledSections = new Set([
    "Incident Verdict",
    "What happened",
    "Explanation",
    "Suggested causes",
    "Suggested fixes",
    "Trigger candidate",
    "Engine analysis",
    "Event distribution",
    "System health summary",
    "Strongest signals",
    "Root cause candidates",
    "Next best actions",
    "Incident metadata",
    "Diagnostics",
    "AI Summary",
    "Follow-up questions",
    "Recommended checks",
    "Schema snapshot",
    "Score breakdowns",
    "Propagation explainability",
    "Warnings",
    "Generate",
    "Export",
    "Status",
    "Report inventory",
  ]);
  if (titledSections.has(trimmed)) return paint(theme, line, theme.bold, theme.primary);
  return line;
}

function isMajorSectionHeader(line: string): boolean {
  const trimmed = line.trim();
  if (/^-- .+ --$/.test(trimmed)) return true;
  return new Set([
    "Incident Verdict",
    "What happened",
    "Explanation",
    "Suggested causes",
    "Suggested fixes",
    "Trigger candidate",
    "Engine analysis",
    "Event distribution",
    "System health summary",
    "Strongest signals",
    "Root cause candidates",
    "Next best actions",
  ]).has(trimmed);
}

function addSectionSpacing(lines: string[]): string[] {
  const out: string[] = [];
  const ensureTrailingBlanks = (count: number): void => {
    let trailing = 0;
    for (let i = out.length - 1; i >= 0; i -= 1) {
      if (out[i].trim() === "") trailing += 1;
      else break;
    }
    for (let i = trailing; i < count; i += 1) out.push("");
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const next = lines[i + 1] ?? "";
    if (isMajorSectionHeader(line) && out.length > 0) {
      // Add stronger visual separation before each major section header.
      ensureTrailingBlanks(2);
    }
    out.push(line);
    if (isMajorSectionHeader(line) && next.trim() !== "") {
      // Keep one empty line between header and its body.
      ensureTrailingBlanks(1);
    }
  }
  return out;
}

function colorizeLine(theme: TuiTheme, line: string): string {
  return colorizeSeverity(theme, colorizeStructure(theme, line));
}

function colorizeLiveStatus(theme: TuiTheme, line: string, live: LiveModeState): string {
  if (!live.enabled) return line.replace("BATCH", paint(theme, "BATCH", theme.success, theme.bold));
  const liveText = live.paused ? `${live.health} (paused)` : live.health;
  const style =
    live.health === "active" ? [theme.bold, theme.danger] :
    live.health === "incident-candidate" ? [theme.bold, theme.warning] :
    live.health === "abnormal" ? [theme.warning] :
    live.health === "stabilizing" ? [theme.info] :
    [theme.success];
  return line.replace(`LIVE:${liveText}`, paint(theme, `LIVE:${liveText}`, ...style));
}

function wrapToWidth(text: string, width: number): string[] {
  if (width < 1) return [text];
  if (text.length === 0) return [""];
  const out: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= width) {
      out.push(remaining);
      break;
    }
    const chunk = remaining.slice(0, width);
    const lastSpace = chunk.lastIndexOf(" ");
    const breakAt = lastSpace > width * 0.5 ? lastSpace : width;
    out.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).replace(/^\s+/, "");
  }
  return out;
}

function getBoxDimensions(termWidth: number): { boxWidth: number; innerWidth: number } {
  const boxWidth = Math.max(40, termWidth - 2);
  return { boxWidth, innerWidth: boxWidth - 2 };
}

function expandRows(lines: string[], innerWidth: number, withSectionSpacing = false): string[] {
  const source = withSectionSpacing ? addSectionSpacing(lines) : lines;
  const wrapped: string[] = [];
  for (const line of source) wrapped.push(...wrapToWidth(line, innerWidth));
  return wrapped;
}

function formatBottomWorkspace(
  mainLines: string[],
  sideLines: string[],
  theme: TuiTheme,
  budget?: {
    maxMainLines: number;
    maxSideLines: number;
    mainOffset?: number;
    sideOffset?: number;
    maxMainScroll?: number;
    maxSideScroll?: number;
    focusRegion?: "main" | "side";
  }
): string[] {
  const width = process.stdout.columns ?? 120;
  const mainMax = Math.max(8, budget?.maxMainLines ?? 30);
  const sideMax = Math.max(6, budget?.maxSideLines ?? 10);
  const { innerWidth } = getBoxDimensions(width);
  const wrappedMainRows = expandRows(mainLines, innerWidth, true);
  const wrappedSideRows = expandRows(sideLines, innerWidth, false);
  const rawOffset = budget?.mainOffset ?? 0;
  const rawSideOffset = budget?.sideOffset ?? 0;
  const maxOffset = Math.max(0, wrappedMainRows.length - mainMax);
  const maxSideOffset = Math.max(0, wrappedSideRows.length - sideMax);
  const mainOffset = Math.max(0, Math.min(rawOffset, maxOffset));
  const sideOffset = Math.max(0, Math.min(rawSideOffset, maxSideOffset));
  const main = wrappedMainRows.slice(mainOffset, mainOffset + mainMax);
  const side = wrappedSideRows.slice(sideOffset, sideOffset + sideMax);
  const maxMainScroll = budget?.maxMainScroll ?? 0;
  const maxSideScroll = budget?.maxSideScroll ?? 0;
  const canScroll = maxMainScroll > 0;
  const canScrollSide = maxSideScroll > 0;
  const focusRegion = budget?.focusRegion ?? "main";

  const lines: string[] = [];
  const border = (left: string, right: string) => paint(theme, left, theme.muted) + paint(theme, "─".repeat(innerWidth), theme.muted) + paint(theme, right, theme.muted);

  lines.push(border("┌", "┐"));
  const title = " Analysis" + (canScroll ? "  ↑↓ scroll" : "");
  const analysisTitleStyle = focusRegion === "main" ? [theme.bold, theme.primary] : [theme.bold, theme.accent];
  lines.push(paint(theme, "│", theme.muted) + paint(theme, title, ...analysisTitleStyle) + " ".repeat(Math.max(0, innerWidth - title.length)) + paint(theme, "│", theme.muted));
  lines.push(border("├", "┤"));
  for (const line of main) {
    const padded = line.padEnd(innerWidth).slice(0, innerWidth);
    lines.push(paint(theme, "│", theme.muted) + colorizeLine(theme, padded) + paint(theme, "│", theme.muted));
  }
  lines.push(border("└", "┘"));

  if (canScroll) lines.push("");
  lines.push(border("┌", "┐"));
  const contextTitle = " Context" + (canScrollSide ? "  ↑↓ scroll" : "");
  const contextTitleStyle = focusRegion === "side" ? [theme.bold, theme.primary] : [theme.bold, theme.accent];
  lines.push(paint(theme, "│", theme.muted) + paint(theme, contextTitle, ...contextTitleStyle) + " ".repeat(Math.max(0, innerWidth - contextTitle.length)) + paint(theme, "│", theme.muted));
  lines.push(border("├", "┤"));
  for (const line of side) {
    const padded = line.padEnd(innerWidth).slice(0, innerWidth);
    lines.push(paint(theme, "│", theme.muted) + paint(theme, colorizeLine(theme, padded), theme.dim) + paint(theme, "│", theme.muted));
  }
  lines.push(border("└", "┘"));
  return lines;
}


function draw(result: AnalysisResult, state: TuiState, live: LiveModeState, runtime: TuiRuntimeOptions): void {
  const theme = createTheme();
  const cols = process.stdout.columns ?? 120;
  process.stdout.write("\x1Bc");
  const liveStatus = live.enabled ? `${live.health}${live.paused ? " (paused)" : ""}` : "off";
  const shell = renderLayout(result, state, live.enabled, liveStatus);
  const tabs = PANEL_ORDER.map((panel, idx) => {
    const inactive = `[${idx + 1}] ${PANEL_LABELS[panel]}`;
    if (state.activePanel !== panel) return paint(theme, inactive, theme.muted);
    const active = `[${idx + 1}] ${PANEL_LABELS[panel]}`;
    return paint(theme, active, theme.panelActive, theme.bold);
  }).join(" ");
  const topActions =
    "Keys: 1-9 panels | Tab focus | j/k scroll | PgUp/PgDn | / search | f filter | g AI | r/c/i/T | e export | w save | q quit";

  const top0 = colorizeLiveStatus(theme, shell.topStrip[0], live);
  const top1 = shell.topStrip[1]
    .replace("Trigger:", paint(theme, "Trigger:", theme.trigger, theme.bold))
    .replace("Confidence:", paint(theme, "Confidence:", theme.primary))
    .replace("Services:", paint(theme, "Services:", theme.info));
  const top2 = shell.topStrip[2].replace("Warnings:", paint(theme, "Warnings:", theme.warning));

  if (!runtime.hideHeader) {
    process.stdout.write(`${paint(theme, top0, theme.bold)}\n`);
    process.stdout.write(`${top1}\n`);
    process.stdout.write(`${paint(theme, top2, theme.dim)}\n`);
    process.stdout.write(`${tabs}\n`);
    process.stdout.write(`${paint(theme, topActions, theme.muted)}\n`);
  } else {
    const compact = `SOLID ${live.enabled ? "LIVE" : "BATCH"} | Panel ${state.activePanel} | Focus ${state.focusRegion ?? "main"}`;
    process.stdout.write(`${paint(theme, compact, theme.bold, theme.primary)}\n`);
    process.stdout.write(`${tabs}\n`);
    process.stdout.write(`${paint(theme, topActions, theme.muted)}\n`);
  }
  process.stdout.write(`${paint(theme, "─".repeat(Math.max(30, cols - 1)), theme.muted)}\n`);
  const rows = process.stdout.rows ?? 44;
  const headerLines = runtime.hideHeader ? 4 : 5; // compact/full header including top separator
  const footerLines = state.warnings.length ? 3 : 2; // bottom divider + status (+warnings)
  const sectionChrome = 9; // top divider + both box frames/titles/dividers + minimal spacing
  const availableContentLines = Math.max(20, rows - headerLines - footerLines - sectionChrome);
  const maxMainLines = Math.max(10, Math.ceil(availableContentLines * 0.72));
  const maxSideLines = Math.max(6, availableContentLines - maxMainLines);
  const { innerWidth } = getBoxDimensions(cols);
  const wrappedMainLength = expandRows(shell.mainPanel, innerWidth, true).length;
  const wrappedSideLength = expandRows(shell.sidePanel, innerWidth, false).length;
  const maxMainScroll = Math.max(0, wrappedMainLength - maxMainLines);
  const maxSideScroll = Math.max(0, wrappedSideLength - maxSideLines);
  state.mainScroll = Math.max(0, Math.min(state.mainScroll, maxMainScroll));
  state.sideScroll = Math.max(0, Math.min(state.sideScroll, maxSideScroll));

  const split = state.showHelp
    ? renderHelp().map((line) => (line.startsWith("Help") ? paint(theme, line, theme.bold, theme.primary) : line))
    : formatBottomWorkspace(shell.mainPanel, shell.sidePanel, theme, {
        maxMainLines,
        maxSideLines,
        mainOffset: state.mainScroll,
        sideOffset: state.sideScroll,
        maxMainScroll,
        maxSideScroll,
        focusRegion: state.focusRegion,
      });
  for (const line of split) process.stdout.write(`${line}\n`);
  process.stdout.write(`${paint(theme, "─".repeat(Math.max(30, cols - 1)), theme.muted)}\n`);
  const statusLine = shell.footer[1].replace("Status:", paint(theme, "Status:", theme.success, theme.bold));
  process.stdout.write(`${statusLine}\n`);
  if (!state.showHelp && (maxMainScroll > 0 || maxSideScroll > 0)) {
    const active = state.focusRegion ?? "main";
    const mainStatus = `main ${state.mainScroll}/${maxMainScroll}`;
    const sideStatus = `context ${state.sideScroll}/${maxSideScroll}`;
    process.stdout.write(`${paint(theme, `Scroll [focus=${active}]: ${mainStatus} | ${sideStatus} (Tab focus, j/k, PgUp/PgDn, Home/End)`, theme.muted)}\n`);
  }

  if (state.warnings.length) {
    process.stdout.write(`${paint(theme, "Warnings:", theme.bold, theme.warning)} ${paint(theme, state.warnings.slice(-3).join(" | "), theme.warning)}\n`);
  }
}

async function askPrompt(prompt: string): Promise<string> {
  process.stdin.setRawMode?.(false);
  return await new Promise<string>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${prompt}: `, (answer) => {
      rl.close();
      process.stdin.setRawMode?.(true);
      resolve(answer.trim());
    });
  });
}

export async function runTui(
  result: AnalysisResult,
  actions: TuiActions,
  runtime: TuiRuntimeOptions = {},
  liveUpdate?: LiveUpdateConfig
): Promise<void> {
  if (process.env.SOLID_TUI_INIT_FAIL === "1") {
    throw new TuiInitError("TUI initialization failed (forced for test).");
  }
  if (process.stdout.isTTY !== true || process.stdin.isTTY !== true) {
    throw new TuiInitError("TUI requires an interactive terminal with TTY stdin/stdout.");
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode?.(true);

  const resultRef = { current: result };
  const state: TuiState = {
    activePanel: "summary",
    showHelp: false,
    searchQuery: "",
    filter: "",
    mainScroll: 0,
    sideScroll: 0,
    focusRegion: "main",
    warnings: [],
  };
  const live: LiveModeState = {
    enabled: liveUpdate != null || result.inputSources.some((source) => source.kind === "stdin"),
    paused: false,
    health: deriveLiveHealth(
      result.signals.length,
      result.signals.filter((signal) => signal.severity === "critical").length
    ),
  };

  let liveInterval: NodeJS.Timeout | null = null;
  if (liveUpdate) {
    liveInterval = setInterval(() => {
      if (live.paused) return;
      try {
        resultRef.current = liveUpdate.getResult();
        live.health = deriveLiveHealth(
          resultRef.current.signals.length,
          resultRef.current.signals.filter((s) => s.severity === "critical").length
        );
        draw(resultRef.current, state, live, runtime);
      } catch {
        // ignore analysis errors during live refresh
      }
    }, liveUpdate.intervalSeconds * 1000);
  }

  if (!runtime.skipSplash) {
    const splashTheme = createTheme();
    renderSplash(splashTheme);
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  draw(resultRef.current, state, live, runtime);

  await new Promise<void>((resolve) => {
    const onKeypress = async (str: string, key: readline.Key) => {
      const readonlyMode = runtime.inspect === true;
      try {
        if (key.sequence === "\u0003" || str === "q") {
          process.stdin.off("keypress", onKeypress);
          if (liveInterval) clearInterval(liveInterval);
          liveInterval = null;
          process.stdin.setRawMode?.(false);
          process.stdout.write("\n");
          if (liveUpdate?.onQuit) void liveUpdate.onQuit();
          resolve();
          return;
        }
        if (str === "?") state.showHelp = !state.showHelp;
        if (key.name === "tab") {
          state.focusRegion = state.focusRegion === "main" ? "side" : "main";
          state.message = `Focus moved to ${state.focusRegion} panel.`;
        }
        if (str === "x") {
          state.searchQuery = "";
          state.filter = "";
          state.mainScroll = 0;
          state.sideScroll = 0;
          state.message = "Cleared search and filter state.";
        }
        if (str === "/") state.searchQuery = await askPrompt("Search");
        if (str === "f") state.filter = await askPrompt("Filter");
        const focus = state.focusRegion ?? "main";
        if (str === "j" || key.name === "down") {
          if (focus === "main") state.mainScroll += 1;
          else state.sideScroll += 1;
        }
        if (str === "k" || key.name === "up") {
          if (focus === "main") state.mainScroll -= 1;
          else state.sideScroll -= 1;
        }
        if (key.name === "pageup") {
          const delta = Math.max(6, Math.floor((process.stdout.rows ?? 40) * 0.45));
          if (focus === "main") state.mainScroll -= delta;
          else state.sideScroll -= delta;
        }
        if (key.name === "pagedown") {
          const delta = Math.max(6, Math.floor((process.stdout.rows ?? 40) * 0.45));
          if (focus === "main") state.mainScroll += delta;
          else state.sideScroll += delta;
        }
        if (key.name === "home") {
          if (focus === "main") state.mainScroll = 0;
          else state.sideScroll = 0;
        }
        if (str === "G" || key.name === "end") {
          if (focus === "main") state.mainScroll = Number.MAX_SAFE_INTEGER;
          else state.sideScroll = Number.MAX_SAFE_INTEGER;
        }
        if (str === "r") {
          if (readonlyMode) {
            state.message = "Readonly mode: report generation is disabled.";
            draw(resultRef.current, state, live, runtime);
            return;
          }
          await actions.onGenerateIncidentReport(resultRef.current);
          state.message = "Incident report generated.";
        }
        if (str === "c") {
          if (readonlyMode) {
            state.message = "Readonly mode: report generation is disabled.";
            draw(resultRef.current, state, live, runtime);
            return;
          }
          await actions.onGenerateRcaReport(resultRef.current);
          state.message = "RCA report generated.";
        }
        if (str === "i") {
          if (readonlyMode) {
            state.message = "Readonly mode: story generation is disabled.";
            draw(resultRef.current, state, live, runtime);
            return;
          }
          await actions.onGenerateInterviewStory(resultRef.current);
          state.message = "Interview story generated.";
        }
        if (str === "T" && actions.onGenerateTechnicalTimeline) {
          if (readonlyMode) {
            state.message = "Readonly mode: timeline report generation is disabled.";
            draw(resultRef.current, state, live, runtime);
            return;
          }
          await actions.onGenerateTechnicalTimeline(resultRef.current);
          state.message = "Technical timeline generated.";
        }
        if (str === "w") {
          if (readonlyMode) {
            state.message = "Readonly mode: session save is disabled.";
            draw(resultRef.current, state, live, runtime);
            return;
          }
          await actions.onSave(resultRef.current);
          state.message = "Session saved.";
        }
        if (str === "g") {
          await actions.onRefreshAi(resultRef.current);
          state.message = "Refreshed AI analysis.";
        }
        if (str === "u" && actions.onManualLiveAiUpdate) {
          await actions.onManualLiveAiUpdate(resultRef.current);
          state.message = "Manual AI update completed.";
        }
        if (str === "e") {
          if (readonlyMode) {
            state.message = "Readonly mode: export is disabled.";
            draw(resultRef.current, state, live, runtime);
            return;
          }
          await actions.onExport(resultRef.current);
          state.message = "Export completed.";
        }
        if (str === "p" && live.enabled) {
          live.paused = !live.paused;
          state.message = live.paused ? "Live view paused." : "Live view resumed.";
        }
        if (str === "F" && live.enabled && actions.onFinalizeLive) {
          if (readonlyMode) {
            state.message = "Readonly mode: finalize is disabled.";
            draw(resultRef.current, state, live, runtime);
            return;
          }
          await actions.onFinalizeLive(resultRef.current);
          state.message = "Live snapshot finalized.";
        }
        if (str === "t") {
          state.activePanel = "timeline";
          state.searchQuery = "trigger";
          state.mainScroll = 0;
          state.sideScroll = 0;
          state.message = "Jumped to trigger context in timeline.";
        }
        if (str === "s") {
          state.activePanel = "signals";
          state.mainScroll = 0;
          state.sideScroll = 0;
          state.message = "Jumped to strongest signal.";
        }
        if (str === "a") {
          state.activePanel = "ai-analysis";
          state.mainScroll = 0;
          state.sideScroll = 0;
          state.message = "Opened AI explanation panel.";
        }

        const idx = Number.parseInt(str, 10);
        if (!Number.isNaN(idx) && idx >= 1 && idx <= PANEL_ORDER.length) {
          state.activePanel = PANEL_ORDER[idx - 1];
          state.showHelp = false;
          state.mainScroll = state.activePanel === "timeline" ? Number.MAX_SAFE_INTEGER : 0;
          state.sideScroll = 0;
          state.message = undefined;
        }
      } catch (error) {
        state.warnings.push(error instanceof Error ? error.message : String(error));
      } finally {
        draw(resultRef.current, state, live, runtime);
      }
    };
    process.stdin.on("keypress", onKeypress);
  });
}

