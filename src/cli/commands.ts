import { resolve } from "path";
import { readFile, writeFile } from "fs/promises";
import { Command, Help } from "commander";
import type { AiAnalysis, AnalysisContext, InputSource, RawLogLine } from "../contracts/index.js";
import type { AnalyzeFlags, AnalysisResult, AppMode, SessionRecord } from "../contracts/index.js";
import { InputError, SolidError, TuiInitError } from "../contracts/index.js";
import { analyzeLocally } from "../engine/analysisEngine.js";
import { deriveAssessment } from "../engine/incidentAssessment.js";
import { renderByMode, renderError } from "../output/renderers.js";
import { deleteSession, getSession, listSessions, saveSession } from "../storage/sessionStore.js";
import { loadConfig, setConfigKey } from "../storage/configStore.js";
import { runTui, runWelcome } from "../tui/renderer.js";
import { runWithAnalyzingAnimation } from "../tui/analyzingAnimation.js";
import { serveAnalysis } from "../web/server.js";
import { LiveIngestionMultiplexer } from "../core/live/liveIngestionMultiplexer.js";
import type { SourceDescriptor } from "../core/live/types.js";
import { BYO_OUTBOUND_LLM_NOTICE } from "../enrich/enrichCliShared.js";
import { runEnrich } from "../enrich/commands/runEnrich.js";
import {
  applyByoEnrichmentToAnalysisResult,
  executeByoFollowUp,
  isByoEnrichConfigured,
  mergeEngineAiWithEnriched,
  validateEnrichmentStyleInput,
} from "../enrich/applyByoToAnalysis.js";
import { applyHeuristicReport } from "../reports/heuristicStructuredReports.js";
import { runReportCommand } from "./reportCommand.js";
import type { TuiActions } from "../tui/renderer.js";
import { loadInput } from "./input.js";
import { decideMode, detectTerminalCapabilities } from "./mode.js";
import { getCompletionScript } from "./completion.js";

interface AnalyzeOptions extends AnalyzeFlags {
  sessionName?: string;
  output?: string;
  inspect?: boolean;
  interval?: number;
  live?: boolean;
  hideHeader?: boolean;
  skipSplash?: boolean;
  logLevel?: "error" | "warn" | "info" | "debug";
  web?: boolean;
  port?: number;
  open?: boolean;
  /** BYO LLM (same contract as `solidx enrich`) */
  provider?: string;
  url?: string;
  apiKey?: string;
  model?: string;
  style?: string;
  enrichTimeout?: number;
  header?: string[];
  temperature?: number;
  maxTokens?: number;
  systemPromptFile?: string;
  promptFile?: string;
  /** Additional BYO passes after primary enrich (non-TUI / blocking analyze only). */
  followUp?: string[];
}

function addAnalyzeOptions(command: Command): Command {
  return command
    .option("--no-tui", "Disable TUI and emit non-interactive output (for CI, scripts, pipes)")
    .option("--json", "Render machine-readable JSON output")
    .option("--text", "Render plain text output (script/CI safe)")
    .option("--md", "Render Markdown incident report")
    .option("--html", "Render HTML report")
    .option("--live", "Tail file(s) and update TUI as new logs arrive")
    .option("--inspect", "Run in inspect (read-only investigation) mode")
    .option("--interval <seconds>", "Set TUI poll/refresh interval in seconds", (v) => Number.parseFloat(v || "2"))
    .option("--hide-header", "Hide the top header strip in TUI")
    .option("--skip-splash", "Skip the startup splash banner")
    .option("--log-level <level>", "Specify a log level (error, warn, info, debug)")
    .option("--save", "Persist analysis as a local session snapshot")
    .option("--session-name <name>", "Set a friendly title for saved session")
    .option("--verbose", "Print extended diagnostics and stack context")
    .option("--no-ai", "Disable BYO LLM (--provider)")
    .option("--finalize", "Mark generated session/report as finalized")
    .option(
      "--heuristic-rca",
      "Non-TUI only: after full pipeline, attach engine-only structured RCA (same as web/TUI R; no AI)",
    )
    .option(
      "--heuristic-interview",
      "Non-TUI only: attach engine-only STAR narrative (same as web/TUI I; no AI)",
    )
    .option("--web", "Hand off analysis to web UI on local port")
    .option("--port <number>", "Port for web UI (default: 3456)", (v) => parseInt(v || "3456", 10))
    .option("--no-open", "Do not open browser when starting web UI");
}

function addByoEnrichOptions(command: Command): Command {
  return command
    .option(
      "--provider <name>",
      "BYO LLM after heuristics: openai-compatible | noop (structured payload; same as solidx enrich). " +
        "With openai-compatible you choose the endpoint; outbound data and provider risk are yours, not SOLIDX’s.",
    )
    .option("--url <endpoint>", "OpenAI-compatible API base URL (required for openai-compatible)")
    .option("--api-key <key>", "Optional API key for BYO provider")
    .option("--model <model>", "Optional model id for BYO provider")
    .option("--style <style>", "Enrichment style with --provider", "briefing")
    .option("--enrich-timeout <ms>", "BYO HTTP timeout in milliseconds", (v) => Number.parseInt(v || "45000", 10))
    .option(
      "--header <key:value>",
      "Extra HTTP header for BYO provider (repeatable)",
      (value, acc: string[]) => [...acc, value],
      [],
    )
    .option("--temperature <number>", "BYO sampling temperature", (v) => Number.parseFloat(v))
    .option("--max-tokens <number>", "BYO max completion tokens", (v) => Number.parseInt(v, 10))
    .option("--system-prompt-file <path>", "Override BYO system prompt from file")
    .option("--prompt-file <path>", "Override BYO user prompt from file")
    .option(
      "--follow-up <style>",
      "After primary BYO enrich, run another pass (repeatable): rca, executive, runbook, star, car, debug, questions (see --style list)",
      (value, acc: string[]) => [...acc, value],
      [],
    );
}

function analysisInputLabel(result: AnalysisResult): string {
  const names = result.inputSources.map((s) => s.name).filter(Boolean);
  return names.length ? names.join(",") : "analyze";
}

function markLazyEnrichPending(result: AnalysisResult, options: AnalyzeOptions): void {
  if (options.noAi) return;
  if (options.live && isByoEnrichConfigured(options)) return;
  if (isByoEnrichConfigured(options)) {
    result.ai.enrichmentPending = true;
    result.ai.enrichmentLoading = false;
    result.ai.warning = "LLM enrichment is starting…";
    if (options.provider?.trim() === "openai-compatible") {
      result.ai.byoProviderNotice = BYO_OUTBOUND_LLM_NOTICE;
    }
  }
}

async function maybeEnrichWithAi(result: AnalysisResult, options: AnalyzeOptions): Promise<void> {
  if (options.noAi) {
    result.ai.warning = "AI disabled by --no-ai flag.";
    result.ai.enrichmentPending = false;
    result.ai.enrichmentLoading = false;
    return;
  }
  if (isByoEnrichConfigured(options)) {
    result.ai.enrichmentPending = false;
    result.ai.enrichmentLoading = true;
    try {
      await applyByoEnrichmentToAnalysisResult(result, options, analysisInputLabel(result));
    } catch (error) {
      result.ai.enrichmentLoading = false;
      result.ai.enrichmentPending = false;
      result.ai.available = false;
      const msg = error instanceof Error ? error.message : String(error);
      result.ai.warning = `BYO enrichment failed: ${msg}`;
      result.diagnostics.warnings.push(result.ai.warning);
      return;
    }
    result.ai.enrichmentLoading = false;
    result.ai.enrichmentPending = false;
    result.diagnostics.transport.backendReachable = false;
    return;
  }

  result.ai.warning = "AI unavailable: add --provider openai-compatible (or noop) for LLM enrichment.";
  result.ai.enrichmentPending = false;
  result.ai.enrichmentLoading = false;
}

function fromSession(session: SessionRecord, mode: AppMode): AnalysisResult {
  const schema = session.schemaSnapshot as AnalysisResult["schema"];
  const traceGraph = schema.traceGraph ?? {
    nodes: schema.summary.affectedServices ?? [],
    edges: schema.flow.map((e) => ({ from: e.from, to: e.to, annotation: "impact", count: e.count, confidence: e.confidence })),
    triggerCandidates: [],
  };
  const assessment = schema.assessment ?? deriveAssessment({
    timeline: schema.timeline,
    traceGraph,
    signals: schema.signals,
  });
  return {
    mode,
    inputSources: session.inputSources,
    summary: schema.summary,
    assessment,
    timeline: schema.timeline,
    flow: schema.flow,
    traceGraph,
    rawEvents: schema.timeline,
    signals: schema.signals,
    ai: session.backendResponse,
    schema: { ...schema, traceGraph, assessment },
    diagnostics: {
      warnings: session.warnings,
      errors: [],
      transport: { backendReachable: session.backendResponse.available },
    },
    metadata: {
      rawLineCount: session.schemaSnapshot.timeline.length,
      createdAt: session.createdAt,
    },
  };
}

export type TuiEnrichContext = Pick<AnalyzeOptions, "noAi" | "live"> & {
  /** Full analyze flags for maybeEnrichWithAi (BYO). */
  enrichFrom?: AnalyzeOptions;
};

export async function runTuiWithFallback(
  result: AnalysisResult,
  runtime?: Pick<AnalyzeOptions, "inspect" | "interval" | "hideHeader" | "skipSplash" | "logLevel">,
  liveUpdate?: import("../tui/renderer.js").LiveUpdateConfig,
  options?: TuiEnrichContext,
  extraTuiActions?: Partial<TuiActions>,
): Promise<{ fellBack: boolean; fallbackText?: string }> {
  const enrichOpts: AnalyzeOptions =
    options?.enrichFrom ??
    ({
      noAi: options?.noAi,
      live: options?.live,
    } as AnalyzeOptions);
  const useEnrich = !options?.noAi && isByoEnrichConfigured(enrichOpts);

  try {
    await runTui(result, {
      onRefreshAi: async (r) => {
        if (!useEnrich) return;
        try {
          await maybeEnrichWithAi(r, enrichOpts);
        } catch (err) {
          r.ai.available = false;
          r.ai.enrichmentLoading = false;
          r.ai.enrichmentPending = false;
          r.ai.warning = err instanceof Error ? err.message : "LLM refresh failed.";
        }
      },
      onExport: async (_r) => {},
      onSave: async (_r) => {},
      ...extraTuiActions,
    }, {
      inspect: runtime?.inspect,
      intervalSeconds: runtime?.interval,
      hideHeader: runtime?.hideHeader,
      skipSplash: runtime?.skipSplash,
      logLevel: runtime?.logLevel,
      backgroundEnrich: useEnrich && result.ai.enrichmentPending ? () => maybeEnrichWithAi(result, enrichOpts) : undefined,
      byoFollowUpAvailable: isByoEnrichConfigured(enrichOpts) && !options?.noAi,
      byoEnrichOptions: enrichOpts,
    }, liveUpdate);
    return { fellBack: false };
  } catch (error) {
    if (error instanceof TuiInitError) {
      const warning = `Warning: ${error.message} Falling back to plain text mode.`;
      const text = `${warning}\n\n${renderByMode(result, "text")}`;
      process.stdout.write(`${text}\n`);
      return { fellBack: true, fallbackText: text };
    }
    throw error;
  }
}

async function runLiveAnalyze(files: string[], options: AnalyzeOptions): Promise<void> {
  const rawLines: RawLogLine[] = [];
  const sources: InputSource[] = files.map((f) => ({ kind: "file" as const, name: f }));

  const multiplexer = new LiveIngestionMultiplexer({
    fromStart: true,
    pollIntervalMs: 250,
    onWarning: (w) => process.stderr.write(`[solidx] ${w}\n`),
  });
  multiplexer.onResult((r) => {
    rawLines.push({
      line: r.line.line,
      lineNumber: r.line.lineNumber,
      source: "file",
      sourceName: r.line.sourceName,
    });
  });

  const fileSources: SourceDescriptor[] = files.map((f, i) => ({
    sourceId: `file-${i}`,
    sourceName: f,
    sourcePath: resolve(f),
    sourceType: "file" as const,
  }));
  await multiplexer.start(fileSources);

  const intervalSeconds = options.interval ?? 2;
  const liveAiSnapshot: { ai: AiAnalysis | null } = { ai: null };
  /** Preserved across live re-analyze ticks so finalize (F) keeps final-style wording until quit. */
  const liveSessionFlags = { streamFinalized: false };
  let liveEnrichBusy = false;
  let liveEnrichInterval: ReturnType<typeof setInterval> | null = null;

  const liveAnalysisContext = (): AnalysisContext => ({
    runKind: "live",
    ...(liveSessionFlags.streamFinalized ? { streamFinalized: true } : {}),
  });

  const getFresh = (): AnalysisResult => {
    if (rawLines.length === 0) {
      throw new SolidError("EMPTY_INPUT", "No logs yet. Waiting for input…", { recoverable: true });
    }
    return analyzeLocally({
      rawLines: [...rawLines],
      inputSources: sources,
      mode: "tui",
      analysisContext: liveAnalysisContext(),
    });
  };

  const getResult = (): AnalysisResult => {
    const base = getFresh();
    const baseAi =
      !options.noAi && options.provider?.trim() === "openai-compatible"
        ? { ...base.ai, byoProviderNotice: BYO_OUTBOUND_LLM_NOTICE }
        : base.ai;
    let ai = liveAiSnapshot.ai ? mergeEngineAiWithEnriched(baseAi, liveAiSnapshot.ai) : baseAi;
    if (liveEnrichBusy) {
      ai = { ...ai, enrichmentLoading: true, enrichmentPending: false };
    }
    return { ...base, ai };
  };

  if (!options.noAi && isByoEnrichConfigured(options)) {
    const enrichEveryMs = Math.max(2000, intervalSeconds * 1000);
    const tick = (): void => {
      if (liveEnrichBusy || rawLines.length === 0) return;
      liveEnrichBusy = true;
      let snap: AnalysisResult;
      try {
        snap = getFresh();
      } catch {
        liveEnrichBusy = false;
        return;
      }
      void applyByoEnrichmentToAnalysisResult(snap, options, "live-tail")
        .then(() => {
          liveAiSnapshot.ai = { ...snap.ai };
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          liveAiSnapshot.ai = {
            ...snap.ai,
            available: false,
            enrichmentLoading: false,
            enrichmentPending: false,
            warning: `BYO enrichment failed: ${msg}`,
            ...(options.provider?.trim() === "openai-compatible"
              ? { byoProviderNotice: BYO_OUTBOUND_LLM_NOTICE }
              : {}),
          };
        })
        .finally(() => {
          liveEnrichBusy = false;
        });
    };
    liveEnrichInterval = setInterval(tick, enrichEveryMs);
    queueMicrotask(tick);
  }

  let initialResult: AnalysisResult;
  try {
    initialResult = getResult();
  } catch {
    initialResult = analyzeLocally({
      rawLines: [{ line: "Waiting for logs…", lineNumber: 1, source: "file", sourceName: files[0] ?? "stdin" }],
      inputSources: sources,
      mode: "tui",
      analysisContext: liveAnalysisContext(),
    });
  }

  await runTuiWithFallback(
    initialResult,
    {
      inspect: options.inspect ?? true,
      interval: intervalSeconds,
      hideHeader: options.hideHeader,
      skipSplash: options.skipSplash ?? true,
      logLevel: options.logLevel,
    },
    {
      intervalSeconds,
      getResult,
      onQuit: () => {
        if (liveEnrichInterval) clearInterval(liveEnrichInterval);
        liveEnrichInterval = null;
        multiplexer.stop();
      },
    },
    { noAi: options.noAi, enrichFrom: options, live: true },
    {
      onFinalizeLive: async (r) => {
        liveSessionFlags.streamFinalized = true;
        r.metadata = {
          ...r.metadata,
          analysisContext: {
            runKind: "live",
            streamFinalized: true,
          },
        };
      },
    },
  );
}

export async function runAnalyze(files: string[], options: AnalyzeOptions): Promise<void> {
  const forceNonInteractiveOutput = Boolean(options.output);
  const hasExplicitFormat = Boolean(options.json || options.text || options.md || options.html);
  const effectiveOptions: AnalyzeOptions = forceNonInteractiveOutput
    ? {
        ...options,
        noTui: true,
        json: hasExplicitFormat ? options.json : true,
      }
    : options;
  const caps = detectTerminalCapabilities();
  const mode = effectiveOptions.web ? "text" : decideMode(effectiveOptions, caps);

  if (!effectiveOptions.noAi && effectiveOptions.provider?.trim() === "openai-compatible") {
    process.stderr.write(`[solidx] ${BYO_OUTBOUND_LLM_NOTICE}\n\n`);
  }

  let result: AnalysisResult;

  if (effectiveOptions.live && files.length > 0 && caps.interactive) {
    await runLiveAnalyze(files, effectiveOptions);
    return;
  }

  if (effectiveOptions.web) {
    result = await runWithAnalyzingAnimation(
      async () => {
        const input = await loadInput(files);
        return analyzeLocally({
          rawLines: input.lines,
          inputSources: input.sources,
          mode: "text",
        });
      },
      { skipSplash: options.skipSplash ?? true, useAi: false },
    );
  } else if (mode === "tui" && caps.interactive) {
    result = await runWithAnalyzingAnimation(
      async () => {
        const input = await loadInput(files);
        const r = analyzeLocally({
          rawLines: input.lines,
          inputSources: input.sources,
          mode,
        });
        return r;
      },
      { skipSplash: options.skipSplash, useAi: false },
    );
  } else {
    const input = await loadInput(files);
    result = analyzeLocally({
      rawLines: input.lines,
      inputSources: input.sources,
      mode,
    });
  }

  if (!effectiveOptions.web && mode !== "tui" && !effectiveOptions.live && !effectiveOptions.noAi) {
    await maybeEnrichWithAi(result, effectiveOptions);
  }

  if (
    effectiveOptions.followUp?.length &&
    !effectiveOptions.noAi &&
    isByoEnrichConfigured(effectiveOptions)
  ) {
    for (const fu of effectiveOptions.followUp) {
      const st = validateEnrichmentStyleInput(fu);
      await executeByoFollowUp(result, effectiveOptions, st);
    }
  }

  if (!effectiveOptions.web && mode !== "tui" && !effectiveOptions.live) {
    if (effectiveOptions.heuristicRca) {
      applyHeuristicReport(result, "rca");
    }
    if (effectiveOptions.heuristicInterview) {
      applyHeuristicReport(result, "interview");
    }
  }

  if (effectiveOptions.save) {
    const session = await saveSession(result, options.sessionName);
    result.diagnostics.warnings.push(`Saved session ${session.sessionId}`);
  }

  if (effectiveOptions.web) {
    markLazyEnrichPending(result, effectiveOptions);
    const lazy = Boolean(result.ai.enrichmentPending);
    const { url } = await serveAnalysis(result, {
      port: effectiveOptions.port ?? 3456,
      openBrowser: effectiveOptions.open !== false,
      backgroundEnrich: lazy ? () => maybeEnrichWithAi(result, effectiveOptions) : undefined,
    });
    process.stdout.write(`\nWeb UI ready at ${url}\n`);
    if (lazy) {
      process.stdout.write(`LLM enrichment is running in the background — refresh or open the AI tab; it will update when ready.\n`);
    }
    process.stdout.write(`Press Ctrl+C to stop the server.\n\n`);
    return;
  }

  if (mode === "tui") {
    markLazyEnrichPending(result, effectiveOptions);
    await runTuiWithFallback(
      result,
      {
        inspect: options.inspect,
        interval: options.interval,
        hideHeader: options.hideHeader,
        skipSplash: true,
        logLevel: options.logLevel,
      },
      undefined,
      {
        noAi: options.noAi,
        live: effectiveOptions.live,
        enrichFrom: effectiveOptions,
      },
    );
    return;
  }
  const rendered = renderByMode(result, mode);
  if (effectiveOptions.output) {
    await writeFile(effectiveOptions.output, rendered, "utf8");
    return;
  }
  process.stdout.write(`${rendered}\n`);
}

async function runSessionList(): Promise<void> {
  const sessions = await listSessions();
  if (!sessions.length) {
    process.stdout.write("No sessions found.\n");
    return;
  }
  for (const session of sessions) {
    process.stdout.write(`${session.sessionId}  ${session.updatedAt}  ${session.title}\n`);
  }
}

async function runSessionShow(id: string): Promise<void> {
  const session = await getSession(id);
  if (!session) {
    throw new InputError("INVALID_FILE_PATH", `Session ${id} was not found.`);
  }
  process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
}

async function runSessionDelete(id: string): Promise<void> {
  const deleted = await deleteSession(id);
  if (!deleted) {
    throw new InputError("INVALID_FILE_PATH", `Session ${id} was not found.`);
  }
  process.stdout.write(`Deleted session ${id}\n`);
}

async function runExport(id: string, options: AnalyzeOptions & { output?: string }): Promise<void> {
  const session = await getSession(id);
  if (!session) {
    throw new InputError("INVALID_FILE_PATH", `Session ${id} was not found.`);
  }
  const caps = detectTerminalCapabilities();
  const mode = decideMode(options, caps);
  if (mode === "tui") {
    throw new SolidError("UNSUPPORTED_MODE_COMBINATION", "Export command requires a non-TUI output mode.", { recoverable: true });
  }
  const output = renderByMode(fromSession(session, mode), mode);
  if (options.output) {
    await writeFile(options.output, output, "utf8");
    process.stdout.write(`Exported session ${id} to ${options.output}\n`);
    return;
  }
  process.stdout.write(`${output}\n`);
}

async function runConfigShow(): Promise<void> {
  const config = await loadConfig();
  process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
}

async function runConfigSet(key: string, value: string): Promise<void> {
  const config = await setConfigKey(key as never, value);
  process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
}

export function createProgram(version: string): Command {
  type RawCommanderOptions = AnalyzeOptions & { ai?: boolean };
  const normalizeLogLevel = (level: string | undefined): AnalyzeOptions["logLevel"] => {
    if (level === "error" || level === "warn" || level === "info" || level === "debug") return level;
    return undefined;
  };

  const program = new Command();
  program
    .name("solidx")
    .description("CLI to investigate incidents from logs, streams, and reports.")
    .version(version)
    .showHelpAfterError()
    .showSuggestionAfterError();

  const defaultFormatHelp = Help.prototype.formatHelp;
  program.configureHelp({
    formatHelp: (cmd, helper) => {
      const isRoot = cmd === program;
      if (isRoot) {
        const termWidth = helper.padWidth(cmd, helper);
        const helpWidth = (helper as { helpWidth?: number }).helpWidth || 80;
        const itemIndentWidth = 2;
        const itemSeparatorWidth = 2;
        const formatItem = (term: string, description: string) => {
          if (description) {
            const fullText = `${term.padEnd(termWidth + itemSeparatorWidth)}${description}`;
            return (helper as { wrap: (s: string, w: number, i: number) => string }).wrap(
              fullText,
              helpWidth - itemIndentWidth,
              termWidth + itemSeparatorWidth,
            );
          }
          return term;
        };
        const formatList = (arr: string[]) =>
          arr.join("\n").replace(/^/gm, " ".repeat(itemIndentWidth));

        const commandList = helper.visibleCommands(cmd).map((c) =>
          formatItem(helper.subcommandTerm(c), helper.subcommandDescription(c)),
        );
        const analyzeCmd = cmd.commands.find((c) => c.name() === "analyze");
        const allOpts = analyzeCmd
          ? [...helper.visibleOptions(cmd), ...helper.visibleOptions(analyzeCmd)]
          : helper.visibleOptions(cmd);
        const seen = new Set<string>();
        const optsToShow = allOpts.filter((opt) => {
          const term = helper.optionTerm(opt);
          if (seen.has(term)) return false;
          seen.add(term);
          return true;
        });
        const optionList = optsToShow.map((opt) =>
          formatItem(helper.optionTerm(opt), helper.optionDescription(opt)),
        );

        let out: string[] = [
          "SOLIDX is a CLI to investigate incidents from logs, streams, and reports.",
          "",
          "Usage:",
          "  solidx [flags]",
          "  solidx [command]",
          "",
          "Available Commands:",
          formatList(commandList),
          "",
          "Flags:",
          formatList(optionList),
          "",
          'Use "solidx [command] --help" for more information about a command.',
        ];
        return out.join("\n");
      }
      const out = defaultFormatHelp.call(helper, cmd, helper);
      return out.replace(/^Options:/m, "Flags:");
    },
  });

  const analyzeCmd = program
    .command("analyze [files...]")
    .summary("Analyze logs from files/stdin")
    .description(
      "Run local deterministic heuristics, then optionally call a BYO LLM on the structured snapshot (--provider). " +
        "`solidx enrich` re-runs LLM on saved JSON without re-parsing logs. " +
        "SOLIDX does not host LLMs: with openai-compatible, you supply the URL and bear responsibility for that service, data handling, and model output."
    )
    .option("-o, --output <path>", "Write rendered analysis output to a file");
  addAnalyzeOptions(analyzeCmd);
  addByoEnrichOptions(analyzeCmd);
  analyzeCmd
    .addHelpText(
      "after",
      `
BYO / openai-compatible: enrichment sends a structured payload from your machine to the URL you configure.
You are responsible for that endpoint, credentials, compliance, and model behavior. SOLIDX is not responsible for your BYO provider.

Examples:
  solidx analyze app.log
  solidx analyze api.log worker.log db.log
  cat incident.log | solidx analyze
  kubectl logs deploy/api -n prod | solidx analyze
  solidx analyze logs.txt --inspect --interval 2 --skip-splash
  solidx analyze logs.txt --json --no-ai

BYO LLM on the same command (structured payload; no raw log dump by default):
  solidx analyze app.log --provider openai-compatible \\
    --url http://127.0.0.1:11434/v1 --model llama3.1

  solidx analyze app.log --web --provider openai-compatible \\
    --url https://api.openai.com/v1 --api-key "$OPENAI_API_KEY" --model gpt-4o-mini

Live tail + periodic BYO refresh (uses --interval for both TUI and enrich cadence):
  solidx analyze --live app.log --provider openai-compatible --url http://127.0.0.1:11434/v1 --model llama3.1

Blocking analyze: extra BYO styles after primary enrich (repeatable --follow-up):
  solidx analyze app.log --text --provider openai-compatible \\
    --url http://127.0.0.1:11434/v1 --model llama3.1 \\
    --follow-up executive --follow-up runbook

Still useful: enrich-only on saved JSON (re-style / re-model without re-analyzing):
  solidx analyze app.log --json -o analysis.json
  solidx enrich analysis.json --provider openai-compatible --url http://127.0.0.1:11434/v1 --model llama3.1
`,
    )
    .action(async function (this: Command, files: string[]) {
      const opts = this.opts() as RawCommanderOptions;
      const normalized: AnalyzeOptions = {
        ...opts,
        noAi: opts.noAi ?? opts.ai === false,
        noTui: opts.noTui,
        logLevel: normalizeLogLevel((opts as { logLevel?: string }).logLevel),
      };
      const p = normalized.provider?.trim();
      if (p && p !== "noop" && p !== "openai-compatible") {
        throw new SolidError("INVALID_FLAGS", `Unknown --provider "${p}". Use openai-compatible or noop.`, {
          recoverable: true,
        });
      }
      if (p === "openai-compatible" && !normalized.url?.trim()) {
        throw new SolidError("INVALID_FLAGS", "--provider openai-compatible requires --url.", { recoverable: true });
      }
      if (normalized.followUp?.length && !isByoEnrichConfigured(normalized)) {
        throw new SolidError(
          "INVALID_FLAGS",
          "--follow-up requires --provider (BYO). Each value must be a valid --style (see --help).",
          { recoverable: true },
        );
      }
      if (normalized.followUp?.length) {
        for (const fu of normalized.followUp) {
          validateEnrichmentStyleInput(fu);
        }
      }
      await runAnalyze(files ?? [], normalized);
    });

  program
    .command("enrich <analysisJson>")
    .summary("Optional AI enrichment from analysis JSON")
    .description(
      "Run BYO LLM on analysis JSON without re-running heuristics. Prefer `solidx analyze … --provider …` when you want one command. " +
        "With openai-compatible, outbound requests and provider risk are yours; SOLIDX does not operate your model."
    )
    .requiredOption("--provider <name>", "Provider name (openai-compatible | noop)")
    .option("--url <endpoint>", "Provider endpoint/base URL")
    .option("--api-key <key>", "Provider API key (or pass through env)")
    .option("--model <model>", "Model name")
    .option(
      "--style <style>",
      "briefing | rca | executive | runbook | star | car | debug | questions",
      "briefing",
    )
    .option("--timeout <ms>", "Request timeout in milliseconds", (v) => Number.parseInt(v || "45000", 10))
    .option("--header <key:value>", "Custom HTTP header (repeatable)", (value, acc: string[]) => [...acc, value], [])
    .option("--system-prompt-file <path>", "Override system prompt with file")
    .option("--prompt-file <path>", "Override user prompt with file")
    .option("--output <path>", "Write enrichment output to file")
    .option("--format <format>", "json | markdown | text", "text")
    .option("--temperature <number>", "Sampling temperature", (v) => Number.parseFloat(v))
    .option("--max-tokens <number>", "Max completion tokens", (v) => Number.parseInt(v, 10))
    .addHelpText(
      "after",
      `
BYO / openai-compatible: this command POSTs from your environment to the URL you set. Endpoint choice, secrets, data policy, and model output are your responsibility.

Examples:
  solidx analyze logs.txt --json -o analysis.json
  solidx enrich analysis.json --provider openai-compatible --url http://localhost:11434/v1 --model llama3.1
  solidx enrich analysis.json --provider openai-compatible --url https://my-gateway.example.com/v1 --api-key $API_KEY --model my-model --style executive
`
    )
    .action(async function (this: Command, analysisJson: string) {
      const opts = this.opts() as {
        provider: string;
        url?: string;
        apiKey?: string;
        model?: string;
        style?: "briefing" | "rca" | "executive" | "runbook" | "star" | "car" | "debug" | "questions";
        timeout?: number;
        header?: string[];
        systemPromptFile?: string;
        promptFile?: string;
        output?: string;
        format?: "json" | "markdown" | "text";
        temperature?: number;
        maxTokens?: number;
      };
      await runEnrich(analysisJson, opts);
    });

  program
    .command("report <analysisJson>")
    .summary("Deterministic polished report from analysis JSON")
    .description(
      "Render RCA, STAR, CAR, executive, debug, or timeline narrative from heuristic engine fields only " +
        "(templates + rule-based text cleanup). No LLM. During live tail, save JSON with `metadata.analysisContext.runKind: live` " +
        "or pass `--state live` / `snapshot` for provisional wording."
    )
    .requiredOption("-s, --style <style>", "rca | star | car | executive | debug | timeline")
    .option("--state <state>", "final | snapshot | live | partial (default: inferred from analysis JSON)")
    .option("--no-polish", "Skip rule-based cleanup (whitespace, punctuation, dedupe, micro-grammar)")
    .option("--no-confidence", "Omit confidence section where applicable")
    .option("--no-trust-notes", "Omit trust / diagnostics notes where applicable")
    .option("--no-suggested-fixes", "Omit suggested next steps where applicable")
    .option("-o, --output <path>", "Write markdown report to file")
    .addHelpText(
      "after",
      `
Examples:
  solidx analyze app.log --json -o analysis.json
  solidx report analysis.json --style rca
  solidx report analysis.json -s star --state snapshot -o star.md
  cat analysis.json | solidx report - --style timeline
`,
    )
    .action(async function (this: Command, analysisJson: string) {
      const opts = this.opts() as {
        style: string;
        state?: string;
        polish?: boolean;
        noConfidence?: boolean;
        noTrustNotes?: boolean;
        noSuggestedFixes?: boolean;
        output?: string;
      };
      await runReportCommand(analysisJson, {
        style: opts.style,
        state: opts.state,
        polish: opts.polish,
        output: opts.output,
        noConfidence: opts.noConfidence,
        noTrustNotes: opts.noTrustNotes,
        noSuggestedFixes: opts.noSuggestedFixes,
      });
    });

  const session = program.command("session").summary("Manage saved sessions").description("Manage local sessions");
  session.command("list").summary("List saved sessions").action(runSessionList);
  session.command("show <id>").summary("Show a session by id").action(runSessionShow);
  session.command("delete <id>").summary("Delete a session by id").action(runSessionDelete);

  addAnalyzeOptions(
    program
      .command("export <id>")
      .summary("Export an existing session")
      .description("Export a saved session in text/json/md/html format.")
      .option("--output <path>", "Write rendered output to the specified file path")
      .action(async function (this: Command, id: string) {
        const opts = this.opts() as RawCommanderOptions;
        const normalized: AnalyzeOptions = {
          ...opts,
          noAi: opts.noAi ?? opts.ai === false,
          noTui: opts.noTui,
          logLevel: normalizeLogLevel((opts as { logLevel?: string }).logLevel),
        };
        await runExport(id, normalized);
      })
  );

  const config = program.command("config").summary("View or update config").description("Manage SOLID config");
  config.command("show").summary("Print effective config").action(runConfigShow);
  config.command("set <key> <value>").summary("Set a config key").action(runConfigSet);

  const completion = program
    .command("completion")
    .summary("Generate shell completion script")
    .description("Generate the autocompletion script for solidx for the specified shell.");
  completion
    .command("bash")
    .summary("Generate bash completion")
    .description("Generate the autocompletion script for bash")
    .action(() => {
      process.stdout.write(getCompletionScript("bash"));
    });
  completion
    .command("zsh")
    .summary("Generate zsh completion")
    .description("Generate the autocompletion script for zsh")
    .action(() => {
      process.stdout.write(getCompletionScript("zsh"));
    });
  completion
    .command("fish")
    .summary("Generate fish completion")
    .description("Generate the autocompletion script for fish")
    .action(() => {
      process.stdout.write(getCompletionScript("fish"));
    });
  completion
    .command("powershell")
    .summary("Generate PowerShell completion")
    .description("Generate the autocompletion script for PowerShell")
    .action(() => {
      process.stdout.write(getCompletionScript("powershell"));
    });

  return program;
}

export async function runProgram(version: string, argv = process.argv): Promise<number> {
  const knownCommands = new Set(["analyze", "enrich", "report", "session", "export", "config", "completion"]);
  const globalOnlyFlags = new Set(["--help", "-h", "--version", "-V"]);
  const normalizedArgv = [...argv];
  const firstUserArg = normalizedArgv[2];

  const noExplicitCommand = !firstUserArg || firstUserArg.startsWith("-");
  const isKnownCommand = firstUserArg ? knownCommands.has(firstUserArg) : false;
  const hasGlobalFlagOnly = firstUserArg ? globalOnlyFlags.has(firstUserArg) : false;
  const shouldDefaultToAnalyze =
    (!firstUserArg && process.stdin.isTTY !== true) ||
    (firstUserArg ? (!isKnownCommand && !hasGlobalFlagOnly) : false);

  if (shouldDefaultToAnalyze && noExplicitCommand) {
    normalizedArgv.splice(2, 0, "analyze");
  } else if (shouldDefaultToAnalyze) {
    normalizedArgv.splice(2, 0, "analyze");
  } else if (!firstUserArg && process.stdin.isTTY === true) {
    await runWelcome(version);
    return 0;
  }

  const program = createProgram(version);
  try {
    await program.parseAsync(normalizedArgv);
    return 0;
  } catch (error) {
    process.stderr.write(`${renderError(error, normalizedArgv.includes("--verbose"))}\n`);
    return 1;
  }
}

