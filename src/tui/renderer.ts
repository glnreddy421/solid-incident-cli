import readline from "readline";
import type { AnalysisResult, TuiPanelId, TuiState } from "../contracts/index.js";
import { TuiInitError } from "../contracts/index.js";
import { KEYMAP, PANEL_LABELS, PANEL_ORDER } from "./keymap.js";
import { renderLayout } from "./layout.js";
import { deriveLiveHealth, type LiveModeState } from "./liveMode.js";
import { createTheme, paint, type TuiTheme } from "./theme.js";

export interface TuiActions {
  onGenerateIncidentReport: () => Promise<void>;
  onGenerateRcaReport: () => Promise<void>;
  onGenerateInterviewStory: () => Promise<void>;
  onRefreshAi: () => Promise<void>;
  onSave: () => Promise<void>;
  onExport: () => Promise<void>;
  onFinalizeLive?: () => Promise<void>;
  onManualLiveAiUpdate?: () => Promise<void>;
}

export interface TuiRuntimeOptions {
  inspect?: boolean;
  intervalSeconds?: number;
  hideHeader?: boolean;
  skipSplash?: boolean;
  logLevel?: "error" | "warn" | "info" | "debug";
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
  return next;
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

function formatBottomWorkspace(mainLines: string[], sideLines: string[], theme: TuiTheme): string[] {
  const width = process.stdout.columns ?? 120;
  const mainMax = 30;
  const sideMax = 10;
  const main = mainLines.slice(0, mainMax);
  const side = sideLines.slice(0, sideMax);
  const lines: string[] = [];

  lines.push(paint(theme, "Analysis", theme.bold, theme.primary));
  lines.push(paint(theme, "-".repeat(Math.max(30, width - 1)), theme.muted));
  for (const line of main) lines.push(colorizeSeverity(theme, line));
  lines.push("");
  lines.push(paint(theme, "Context", theme.bold, theme.accent));
  lines.push(paint(theme, "-".repeat(Math.max(30, width - 1)), theme.muted));
  for (const line of side) lines.push(paint(theme, colorizeSeverity(theme, line), theme.dim));
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
    "Top options: 1-8 panels | tab focus | / search | f filter | t trigger | s strongest | g refresh | r/c/i reports | e export | w save | ? help | q quit";

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
  process.stdout.write(`${paint(theme, "-".repeat(Math.max(30, cols - 1)), theme.muted)}\n`);
  const split = state.showHelp
    ? renderHelp().map((line) => (line.startsWith("Help") ? paint(theme, line, theme.bold, theme.primary) : line))
    : formatBottomWorkspace(shell.mainPanel, shell.sidePanel, theme);
  for (const line of split) process.stdout.write(`${line}\n`);
  process.stdout.write(`${paint(theme, "-".repeat(Math.max(30, cols - 1)), theme.muted)}\n`);
  const footerHints = `${shell.footer[0]}  | inspect=${runtime.inspect ? "on" : "off"} interval=${runtime.intervalSeconds ?? 2}s log=${runtime.logLevel ?? "info"}`;

  process.stdout.write(`${paint(theme, footerHints, theme.muted)}\n`);
  const statusLine = shell.footer[1].replace("Status:", paint(theme, "Status:", theme.success, theme.bold));
  process.stdout.write(`${statusLine}\n`);

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

export async function runTui(result: AnalysisResult, actions: TuiActions, runtime: TuiRuntimeOptions = {}): Promise<void> {
  if (process.env.SOLID_TUI_INIT_FAIL === "1") {
    throw new TuiInitError("TUI initialization failed (forced for test).");
  }
  if (process.stdout.isTTY !== true || process.stdin.isTTY !== true) {
    throw new TuiInitError("TUI requires an interactive terminal with TTY stdin/stdout.");
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode?.(true);

  const state: TuiState = {
    activePanel: "summary",
    showHelp: false,
    searchQuery: "",
    filter: "",
    focusRegion: "main",
    warnings: [],
  };
  const live: LiveModeState = {
    enabled: result.inputSources.some((source) => source.kind === "stdin"),
    paused: false,
    health: deriveLiveHealth(
      result.signals.length,
      result.signals.filter((signal) => signal.severity === "critical").length
    ),
  };
  if (!runtime.skipSplash) {
    const splashTheme = createTheme();
    renderSplash(splashTheme);
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  draw(result, state, live, runtime);

  await new Promise<void>((resolve) => {
    const onKeypress = async (str: string, key: readline.Key) => {
      const readonlyMode = runtime.inspect === true;
      try {
        if (key.sequence === "\u0003" || str === "q") {
          process.stdin.off("keypress", onKeypress);
          process.stdin.setRawMode?.(false);
          process.stdout.write("\n");
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
          state.message = "Cleared search and filter state.";
        }
        if (str === "/") state.searchQuery = await askPrompt("Search");
        if (str === "f") state.filter = await askPrompt("Filter");
        if (str === "r") {
          if (readonlyMode) {
            state.message = "Readonly mode: report generation is disabled.";
            draw(result, state, live, runtime);
            return;
          }
          await actions.onGenerateIncidentReport();
          state.message = "Incident report generated.";
        }
        if (str === "c") {
          if (readonlyMode) {
            state.message = "Readonly mode: report generation is disabled.";
            draw(result, state, live, runtime);
            return;
          }
          await actions.onGenerateRcaReport();
          state.message = "RCA report generated.";
        }
        if (str === "i") {
          if (readonlyMode) {
            state.message = "Readonly mode: story generation is disabled.";
            draw(result, state, live, runtime);
            return;
          }
          await actions.onGenerateInterviewStory();
          state.message = "Interview story generated.";
        }
        if (str === "w") {
          if (readonlyMode) {
            state.message = "Readonly mode: session save is disabled.";
            draw(result, state, live, runtime);
            return;
          }
          await actions.onSave();
          state.message = "Session saved.";
        }
        if (str === "g") {
          await actions.onRefreshAi();
          state.message = "Refreshed AI analysis.";
        }
        if (str === "u" && actions.onManualLiveAiUpdate) {
          await actions.onManualLiveAiUpdate();
          state.message = "Manual AI update completed.";
        }
        if (str === "e") {
          if (readonlyMode) {
            state.message = "Readonly mode: export is disabled.";
            draw(result, state, live, runtime);
            return;
          }
          await actions.onExport();
          state.message = "Export completed.";
        }
        if (str === "p" && live.enabled) {
          live.paused = !live.paused;
          state.message = live.paused ? "Live view paused." : "Live view resumed.";
        }
        if (str === "F" && live.enabled && actions.onFinalizeLive) {
          if (readonlyMode) {
            state.message = "Readonly mode: finalize is disabled.";
            draw(result, state, live, runtime);
            return;
          }
          await actions.onFinalizeLive();
          state.message = "Live snapshot finalized.";
        }
        if (str === "t") {
          state.activePanel = "timeline";
          state.searchQuery = "trigger";
          state.message = "Jumped to trigger context in timeline.";
        }
        if (str === "s") {
          state.activePanel = "signals";
          state.message = "Jumped to strongest signal.";
        }

        const idx = Number.parseInt(str, 10);
        if (!Number.isNaN(idx) && idx >= 1 && idx <= PANEL_ORDER.length) {
          state.activePanel = PANEL_ORDER[idx - 1];
          state.showHelp = false;
          state.message = undefined;
        }
      } catch (error) {
        state.warnings.push(error instanceof Error ? error.message : String(error));
      } finally {
        draw(result, state, live, runtime);
      }
    };
    process.stdin.on("keypress", onKeypress);
  });
}

