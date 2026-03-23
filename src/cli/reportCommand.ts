import { writeFile } from "fs/promises";
import { resolve } from "path";
import { SolidError } from "../contracts/errors.js";
import { renderReport } from "../reporting/renderReport.js";
import type { ReportState, ReportStyle } from "../reporting/types.js";
import { loadAnalysisJson } from "./loadAnalysisJson.js";

const STYLES = new Set<ReportStyle>(["rca", "star", "car", "executive", "debug", "timeline"]);
const STATES = new Set<ReportState>(["final", "snapshot", "live", "partial"]);

export interface ReportCommandCliOptions {
  style: string;
  state?: string;
  polish?: boolean;
  output?: string;
  noConfidence?: boolean;
  noTrustNotes?: boolean;
  noSuggestedFixes?: boolean;
}

export async function runReportCommand(analysisJson: string, opts: ReportCommandCliOptions): Promise<void> {
  const style = opts.style as ReportStyle;
  if (!STYLES.has(style)) {
    throw new SolidError(
      "INVALID_FLAGS",
      `Invalid --style "${opts.style}". Use: ${[...STYLES].join(", ")}.`,
      { recoverable: true },
    );
  }

  let state: ReportState | undefined;
  if (opts.state != null && opts.state !== "") {
    if (!STATES.has(opts.state as ReportState)) {
      throw new SolidError(
        "INVALID_FLAGS",
        `Invalid --state "${opts.state}". Use: ${[...STATES].join(", ")}.`,
        { recoverable: true },
      );
    }
    state = opts.state as ReportState;
  }

  const analysis = await loadAnalysisJson(analysisJson);
  const rendered = renderReport(analysis, {
    style,
    state,
    polish: opts.polish !== false,
    includeConfidence: !opts.noConfidence,
    includeTrustNotes: !opts.noTrustNotes,
    includeSuggestedFixes: !opts.noSuggestedFixes,
  });

  const text = rendered.finalText;
  if (opts.output) {
    await writeFile(resolve(opts.output), text, "utf8");
    process.stdout.write(`Wrote ${rendered.style} report (${rendered.state}) to ${opts.output}\n`);
    return;
  }
  process.stdout.write(text);
  if (!text.endsWith("\n")) process.stdout.write("\n");
}
