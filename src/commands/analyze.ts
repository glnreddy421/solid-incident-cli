/**
 * solid analyze [files...] — Analyze log file(s) or stdin and print incident insights.
 * Use --open-web to open the same analysis in the web workspace.
 */

import type { Command } from "commander";
import ora from "ora";
import { analyzeLogs } from "../services/analyzer.js";
import { readLogFile, readLogFiles, readStdinToLines, isStdinTty, FileNotFoundError, EmptyFileError } from "../utils/files.js";
import { filterByTimeWindow } from "../utils/timeFilter.js";
import { openBrowser } from "../utils/browser.js";
import { isBackendConfigured } from "../utils/http.js";
import {
  formatHeader,
  formatSubHeader,
  formatTimelineRow,
  formatSignal,
  formatRootCause,
  formatImpactedServices,
  formatNextSteps,
  formatPrivacy,
  formatError,
  formatBanner,
  formatInfo,
  type ColorMode,
} from "../utils/formatter.js";
import type { AnalysisResult } from "../utils/types.js";
import { generateReport } from "../utils/reportGenerator.js";

export function registerAnalyze(program: Command, options: { noColor?: boolean }) {
  return program
    .command("analyze [files...]")
    .description("Analyze one or more log files or stdin and generate incident insights")
    .option("--json", "Output structured JSON")
    .option("--summary-only", "Print only summary section")
    .option("--timeline-only", "Print only timeline section")
    .option("--no-color", "Disable color")
    .option("--verbose", "Include raw event details")
    .option("--open-web", "Open analysis in web workspace (requires SOLID_API_URL)")
    .option("--since <duration>", "Only lines from last N (e.g. 5m, 1h, 30s)")
    .option("--from <time>", "Start of time window (ISO or HH:MM)")
    .option("--to <time>", "End of time window (ISO or HH:MM)")
    .option("--tail <n>", "Last N lines only", (v) => parseInt(v, 10))
    .option("--report [format]", "Generate incident report (markdown, json, text)")
    .action(async (files: string[], cmdOpts: { json?: boolean; summaryOnly?: boolean; timelineOnly?: boolean; verbose?: boolean; openWeb?: boolean; since?: string; from?: string; to?: string; tail?: number; report?: string }, actionCommand?: { parent?: { opts(): { color?: boolean } } }) => {
      const noColor = options.noColor ?? actionCommand?.parent?.opts?.()?.color === false;
      const color: ColorMode = noColor ? "off" : "on";

      if (cmdOpts.openWeb && !isBackendConfigured()) {
        console.error(formatError("--open-web requires SOLID_API_URL. Set it to use the backend.", color));
        process.exit(1);
      }

      try {
        let rawLines: Awaited<ReturnType<typeof readLogFile>>;
        if (files?.length) {
          rawLines = files.length === 1 ? await readLogFile(files[0]) : await readLogFiles(files);
        } else {
          if (isStdinTty()) {
            console.error(formatError("No input. Provide file(s) or pipe logs: kubectl logs pod | solid analyze --open-web", color));
            process.exit(1);
          }
          rawLines = await readStdinToLines();
          if (rawLines.length === 0) throw new EmptyFileError("stdin");
        }

        if (cmdOpts.since ?? cmdOpts.from ?? cmdOpts.to ?? cmdOpts.tail) {
          rawLines = filterByTimeWindow(rawLines, {
            since: cmdOpts.since,
            from: cmdOpts.from,
            to: cmdOpts.to,
            tail: cmdOpts.tail,
          });
          if (rawLines.length === 0) throw new EmptyFileError("time window (no lines match)");
        }

        const spinner = ora("Analyzing logs...").start();
        const { result, handoff } = await analyzeLogs(rawLines, {
          includeRawEvents: !!cmdOpts.verbose,
          createHandoff: !!cmdOpts.openWeb,
        });
        spinner.succeed("Analysis complete.");

        if (cmdOpts.report) {
          const fmt = !cmdOpts.report || cmdOpts.report === "" ? "markdown" : String(cmdOpts.report).toLowerCase();
          const valid = ["markdown", "json", "text"];
          const format = valid.includes(fmt) ? fmt : "markdown";
          const out = generateReport(result, format as "markdown" | "json" | "text");
          if (format === "json") {
            console.log(JSON.stringify(out, null, 2));
          } else {
            console.log(out);
          }
        } else if (cmdOpts.json) {
          console.log(JSON.stringify(jsonOutput(result), null, 2));
        } else {
          printHumanOutput(result, {
            colorMode: color,
            summaryOnly: !!cmdOpts.summaryOnly,
            timelineOnly: !!cmdOpts.timelineOnly,
            verbose: !!cmdOpts.verbose,
          });
        }

        if (handoff) {
          console.log();
          console.log(formatSubHeader("Web view", color));
          console.log(handoff.webUrl);
          console.log();
          const opened = await openBrowser(handoff.webUrl);
          console.log(opened ? formatInfo("Opening browser…", color) : formatInfo("Could not open browser. Copy the URL above to view in web.", color));
        }
      } catch (err) {
        if (err instanceof FileNotFoundError) {
          console.error(formatError(`Could not read file: ${err.path}`, color));
        } else if (err instanceof EmptyFileError) {
          console.error(formatError(`File is empty: ${err.path}`, color));
        } else {
          console.error(formatError(err instanceof Error ? err.message : String(err), color));
        }
        process.exit(1);
      }
    });
}

function jsonOutput(result: AnalysisResult): Record<string, unknown> {
  return {
    events: result.events,
    signals: result.signals,
    summary: result.summary,
    rawLineCount: result.rawLineCount,
  };
}

function printHumanOutput(
  result: AnalysisResult,
  opts: { colorMode: ColorMode; summaryOnly: boolean; timelineOnly: boolean; verbose: boolean }
) {
  const { colorMode, summaryOnly, timelineOnly } = opts;
  console.log(formatBanner(colorMode));

  if (!summaryOnly) {
    console.log(formatHeader("SOLID Incident Analysis", colorMode));
    console.log(formatSubHeader("Timeline", colorMode));
    for (const e of result.events) {
      console.log(formatTimelineRow(e, colorMode));
      if (opts.verbose && e.raw) console.log("  " + (e.raw.slice(0, 80) + (e.raw.length > 80 ? "…" : "")));
    }
  }

  if (!timelineOnly) {
    if (!summaryOnly) {
      console.log(formatSubHeader("Signals", colorMode));
      for (const s of result.signals) console.log(formatSignal(s, colorMode));
    }
    console.log(formatSubHeader("Likely Root Cause", colorMode));
    console.log(formatRootCause(result.summary, colorMode));
    console.log(formatSubHeader("Impacted Services", colorMode));
    console.log(formatImpactedServices(result.summary.impactedServices, colorMode));
    console.log(formatSubHeader("Suggested Next Steps", colorMode));
    console.log(formatNextSteps(result.summary.suggestedNextSteps));
  }

  if (!summaryOnly && !timelineOnly) {
    console.log(formatSubHeader("Privacy", colorMode));
    console.log(formatPrivacy(colorMode));
  }
}
