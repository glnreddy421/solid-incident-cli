import type { AnalysisResult } from "../contracts/index.js";
import { createTheme, paint, type TuiTheme } from "./theme.js";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const DONE = "✓";

export interface AnalyzingAnimationOptions {
  skipSplash?: boolean;
  useAi?: boolean;
}

/**
 * Shows entrance banner + analyzing animation while running the analysis.
 * Steps: Loading input, Exporting timeline, Extracting context, Summary, Evidence, Scoring, AI summary (if useAi).
 * Total animation budget ~5 seconds; returns as soon as analysis completes.
 */
export async function runWithAnalyzingAnimation(
  runAnalysis: () => Promise<AnalysisResult>,
  opts: AnalyzingAnimationOptions = {}
): Promise<AnalysisResult> {
  const theme = createTheme();
  const useAi = opts.useAi ?? true;
  const steps = [
    "Loading input",
    "Exporting timeline",
    "Extracting context",
    "Building summary",
    "Gathering evidence",
    "Scoring signals",
    ...(useAi ? ["AI summary"] : []),
  ];

  if (!opts.skipSplash) {
    renderSplashWithSpace(theme);
  } else {
    process.stdout.write("\x1Bc\n\n");
  }

  const minDisplayMs = 1400;
  const startedAt = Date.now();
  let completed = 0;
  let frame = 0;
  const stepIntervalMs = 400;
  const frameIntervalMs = 120;

  const writeStepLines = (t: TuiTheme, completed: number, frame: number): void => {
    const visibleCount = Math.min(completed + 1, steps.length);
    for (let i = 0; i < visibleCount; i++) {
      const isDone = i < completed;
      const isActive = i === completed;
      const icon = isDone ? DONE : SPINNER[frame % SPINNER.length];
      const line = `  ${icon}  ${steps[i]}`;
      const styled = isDone
        ? paint(t, line, t.success)
        : `${paint(t, `  ${icon}  `, t.amber)}${paint(t, steps[i], t.primary)}`;
      process.stdout.write(`${styled}\n`);
    }
  };

  const redrawSteps = (): void => {
    writeStepLines(theme, completed, frame);
  };

  const visibleCount = (): number => Math.min(completed + 1, steps.length);

  let lastLineCount = visibleCount();
  redrawSteps();

  const timer = setInterval(() => {
    frame++;
    if (frame * frameIntervalMs >= (completed + 1) * stepIntervalMs && completed < steps.length) {
      completed++;
    }
    process.stdout.write(`\x1b[${lastLineCount}A\x1b[J`);
    redrawSteps();
    lastLineCount = visibleCount();
  }, frameIntervalMs);

  try {
    const result = await runAnalysis();
    clearInterval(timer);
    while (completed < steps.length) {
      completed++;
      process.stdout.write(`\x1b[${lastLineCount}A\x1b[J`);
      redrawSteps();
      lastLineCount = visibleCount();
      await new Promise((r) => setTimeout(r, 180));
    }
    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, minDisplayMs - elapsed);
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    process.stdout.write("\n");
    return result;
  } catch (err) {
    clearInterval(timer);
    throw err;
  }
}

function renderSplashWithSpace(theme: TuiTheme): void {
  const SOLIDX_ART = [
    "  ____    ___   _      ___   ____    _  __",
    " / ___|  / _ \\ | |    |_ _| |  _ \\  \\ \\/ /",
    " \\___ \\ | | | || |     | |  | | | |  \\  / ",
    "  ___) || |_| || |___  | |  | |_| |  /  \\ ",
    " |____/  \\___/ |_____|___|  |____/  /_/\\_\\",
  ];

  const cols = process.stdout.columns ?? 80;
  const ruleLen = Math.min(60, cols - 4);
  const rule = paint(theme, "─".repeat(ruleLen), theme.amber);
  const ruleIndent = " ".repeat(Math.max(0, Math.floor((cols - ruleLen) / 2)));
  const artWidth = Math.max(...SOLIDX_ART.map((l) => l.length));
  const indent = " ".repeat(Math.max(0, Math.floor((cols - artWidth) / 2)));
  const c = (s: string) => " ".repeat(Math.max(0, Math.floor((cols - s.length) / 2))) + s;

  process.stdout.write("\x1Bc\n\n\n\n");
  process.stdout.write(`${ruleIndent}${rule}\n\n`);
  for (const line of SOLIDX_ART) {
    process.stdout.write(`${indent}${paint(theme, line, theme.bold, theme.amber)}\n`);
  }
  process.stdout.write("\n");
  const tagline = "Incident Investigation Console";
  process.stdout.write(`${c(tagline)}\n`.replace(tagline, paint(theme, tagline, theme.bold, theme.amber)));
  process.stdout.write("\n");
  process.stdout.write(`${ruleIndent}${rule}\n\n`);
  const analyzing = "Analyzing…";
  process.stdout.write(`${c(analyzing)}\n`.replace(analyzing, paint(theme, analyzing, theme.primary)));
  process.stdout.write("\n");
}
