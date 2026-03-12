/**
 * solid stream — Analyze logs from stdin in near real time.
 * Usage: kubectl logs -f payment-service | solid stream
 * Use --open-web and press Ctrl+C to send current buffer to API and open web view.
 */

import type { Command } from "commander";
import { readStdinLines, isStdinTty } from "../utils/files.js";
import { parseLines } from "../utils/parser.js";
import { analyzeLogs } from "../services/analyzer.js";
import { runMockAnalysis } from "../services/mockAnalysis.js";
import { openBrowser } from "../utils/browser.js";
import { isBackendConfigured } from "../utils/http.js";
import {
  formatSubHeader,
  formatSignal,
  formatError,
  formatInfo,
  type ColorMode,
} from "../utils/formatter.js";
import { formatTimestampForDisplay } from "../utils/parser.js";

const DEFAULT_WINDOW_SEC = 30;
const DEFAULT_THRESHOLD = 3;

export function registerStream(program: Command, options: { noColor?: boolean }) {
  const colorMode: ColorMode = options.noColor ? "off" : "on";

  return program
    .command("stream")
    .description("Analyze logs from stdin in near real time")
    .option("--window <seconds>", "Rolling analysis window (seconds)", (v) => parseInt(v, 10), DEFAULT_WINDOW_SEC)
    .option("--threshold <number>", "Repeated pattern threshold", (v) => parseInt(v, 10), DEFAULT_THRESHOLD)
    .option("--json", "Emit JSON events")
    .option("--quiet", "Only print warnings/signals")
    .option("--open-web", "On Ctrl+C: send current buffer to API and open web view (requires SOLID_API_URL)")
    .action(async (cmdOpts: { window: number; threshold: number; json?: boolean; quiet?: boolean; openWeb?: boolean }, _opts: unknown, actionCommand?: { parent?: { opts(): { color?: boolean } } }) => {
      const noColor = options.noColor ?? actionCommand?.parent?.opts?.()?.color === false;
      const color: ColorMode = noColor ? "off" : "on";

      if (isStdinTty()) {
        console.error(
          formatError(
            "No input detected on stdin. Try: kubectl logs -f my-pod | solid stream",
            color
          )
        );
        process.exit(1);
      }

      if (cmdOpts.openWeb && !isBackendConfigured()) {
        console.error(formatError("--open-web requires SOLID_API_URL. Set it to use the backend.", color));
        process.exit(1);
      }

      const windowMs = (cmdOpts.window || DEFAULT_WINDOW_SEC) * 1000;
      const threshold = cmdOpts.threshold ?? DEFAULT_THRESHOLD;
      const buffer: { line: string; lineNumber: number; ts: number }[] = [];

      const sendToApiAndOpen = async () => {
        if (buffer.length === 0) return;
        const rawLines = buffer.map((b) => ({ line: b.line, lineNumber: b.lineNumber }));
        try {
          const { handoff } = await analyzeLogs(rawLines, {
            includeRawEvents: true,
            createHandoff: true,
          });
          if (handoff) {
            console.error("");
            console.error(formatSubHeader("Web view (current buffer)", color));
            console.error(handoff.webUrl);
            await openBrowser(handoff.webUrl);
          }
        } catch (err) {
          console.error(formatError(err instanceof Error ? err.message : String(err), color));
        }
      };

      if (cmdOpts.openWeb) {
        process.on("SIGINT", async () => {
          console.error("\n" + formatInfo("Sending current buffer to API...", color));
          await sendToApiAndOpen();
          process.exit(0);
        });
      }

      if (!cmdOpts.quiet) {
        console.error(formatInfo(cmdOpts.openWeb ? "Watching log stream... (Ctrl+C to analyze & open web)" : "Watching log stream...", color));
      }

      let lastAnalysisTs = 0;
      const ANALYSIS_INTERVAL_MS = Math.min(15000, windowMs);

      try {
        for await (const { line, lineNumber } of readStdinLines()) {
          const now = Date.now();
          buffer.push({ line, lineNumber, ts: now });
          const cutoff = now - windowMs;
          while (buffer.length > 0 && buffer[0].ts < cutoff) buffer.shift();

          if (!cmdOpts.quiet && !cmdOpts.json) {
            const events = parseLines(buffer.map((b) => ({ line: b.line, lineNumber: b.lineNumber })));
            const last = events[events.length - 1];
            if (last && (last.severity === "error" || last.severity === "critical" || last.severity === "warning")) {
              const time = formatTimestampForDisplay(last.timestamp);
              console.log(`${time} observed ${last.service} ${last.severity}: ${last.message.slice(0, 60)}`);
            }
          }

          if (now - lastAnalysisTs >= ANALYSIS_INTERVAL_MS && buffer.length >= threshold) {
            lastAnalysisTs = now;
            const rawLines = buffer.map((b) => ({ line: b.line, lineNumber: b.lineNumber }));
            const result = runMockAnalysis(rawLines);
            if (result.signals.length > 0) {
              if (cmdOpts.json) {
                console.log(JSON.stringify({ signals: result.signals, at: new Date().toISOString() }));
              } else {
                console.log("");
                console.log(formatSubHeader("Signals (rolling window)", color));
                for (const s of result.signals) console.log(formatSignal(s, color));
                console.log("");
              }
            }
          }
        }
      } finally {
        if (cmdOpts.openWeb && buffer.length > 0) {
          console.error(formatInfo("Stream ended. Sending buffer to API...", color));
          await sendToApiAndOpen();
        }
      }
    });
}
