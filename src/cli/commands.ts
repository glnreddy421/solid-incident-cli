import { writeFile } from "fs/promises";
import { Command, Help } from "commander";
import { BackendAiClient } from "../api/backendClient.js";
import type { AnalyzeFlags, AnalysisResult, AppMode, ReportType, SessionRecord } from "../contracts/index.js";
import { BackendUnavailableError, InputError, SolidError, TuiInitError } from "../contracts/index.js";
import { analyzeLocally } from "../engine/analysisEngine.js";
import { renderByMode, renderError } from "../output/renderers.js";
import { deleteSession, getSession, listSessions, saveSession } from "../storage/sessionStore.js";
import { loadConfig, setConfigKey } from "../storage/configStore.js";
import { runTui, runWelcome } from "../tui/renderer.js";
import { runWithAnalyzingAnimation } from "../tui/analyzingAnimation.js";
import { loadInput } from "./input.js";
import { decideMode, detectTerminalCapabilities } from "./mode.js";
import { getCompletionScript } from "./completion.js";

interface AnalyzeOptions extends AnalyzeFlags {
  sessionName?: string;
  output?: string;
  inspect?: boolean;
  interval?: number;
  hideHeader?: boolean;
  skipSplash?: boolean;
  logLevel?: "error" | "warn" | "info" | "debug";
}

function addAnalyzeOptions(command: Command): Command {
  return command
    .option("--no-tui", "Disable TUI and emit non-interactive output (for CI, scripts, pipes)")
    .option("--json", "Render machine-readable JSON output")
    .option("--text", "Render plain text output (script/CI safe)")
    .option("--md", "Render Markdown incident report")
    .option("--html", "Render HTML report")
    .option("--inspect", "Run in inspect (read-only investigation) mode")
    .option("--interval <seconds>", "Set TUI poll/refresh interval in seconds", (v) => Number.parseFloat(v || "2"))
    .option("--hide-header", "Hide the top header strip in TUI")
    .option("--skip-splash", "Skip the startup splash banner")
    .option("--log-level <level>", "Specify a log level (error, warn, info, debug)")
    .option("--save", "Persist analysis as a local session snapshot")
    .option("--session-name <name>", "Set a friendly title for saved session")
    .option("--verbose", "Print extended diagnostics and stack context")
    .option("--no-ai", "Disable backend AI enrichment and report generation")
    .option("--finalize", "Mark generated session/report as finalized")
    .option("--report", "Generate incident report from structured schema")
    .option("--rca", "Generate root-cause analysis report")
    .option("--interview-story", "Generate interview-style STAR story");
}

async function maybeGenerateReports(result: AnalysisResult, client: BackendAiClient, options: AnalyzeOptions): Promise<void> {
  const requested: ReportType[] = [];
  if (options.report) requested.push("incident");
  if (options.rca) requested.push("rca");
  if (options.interviewStory) requested.push("interview-story");
  if (requested.length === 0 || options.noAi) return;

  for (const type of requested) {
    const body = await client.generateReport(result.schema, type);
    result.ai.reports[type] = {
      type,
      title: type === "incident" ? "Incident Report" : type === "rca" ? "RCA Report" : "Interview STAR Story",
      body: body || "Backend did not return report content.",
      generatedAt: new Date().toISOString(),
    };
  }
}

async function maybeEnrichWithAi(result: AnalysisResult, options: AnalyzeOptions): Promise<void> {
  if (options.noAi) {
    result.ai.warning = "AI disabled by --no-ai flag.";
    return;
  }
  const client = new BackendAiClient();
  if (!client.isConfigured()) {
    result.ai.warning = "AI unavailable: backend is not configured.";
    return;
  }
  try {
    const ai = await client.enrichIncident(result.schema);
    result.ai = ai;
    result.diagnostics.transport.backendReachable = true;
  } catch (error) {
    if (error instanceof BackendUnavailableError) {
      result.ai.available = false;
      result.ai.warning = `AI unavailable: ${error.message}`;
      result.diagnostics.warnings.push(error.message);
      return;
    }
    throw error;
  }
  await maybeGenerateReports(result, client, options);
}

async function renderAndPrint(result: AnalysisResult, mode: AppMode): Promise<void> {
  if (mode === "tui") {
    throw new TuiInitError("TUI mode requires runTuiWithFallback wrapper.");
  }
  process.stdout.write(`${renderByMode(result, mode)}\n`);
}

function fromSession(session: SessionRecord, mode: AppMode): AnalysisResult {
  return {
    mode,
    inputSources: session.inputSources,
    summary: session.schemaSnapshot.summary,
    timeline: session.schemaSnapshot.timeline,
    flow: session.schemaSnapshot.flow,
    rawEvents: session.schemaSnapshot.timeline,
    signals: session.schemaSnapshot.signals,
    ai: session.backendResponse,
    schema: session.schemaSnapshot,
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

export async function runTuiWithFallback(
  result: AnalysisResult,
  runtime?: Pick<AnalyzeOptions, "inspect" | "interval" | "hideHeader" | "skipSplash" | "logLevel">
): Promise<{ fellBack: boolean; fallbackText?: string }> {
  try {
    await runTui(result, {
      onGenerateIncidentReport: async () => {},
      onGenerateRcaReport: async () => {},
      onGenerateInterviewStory: async () => {},
      onRefreshAi: async () => {},
      onExport: async () => {},
      onSave: async () => {},
    }, {
      inspect: runtime?.inspect,
      intervalSeconds: runtime?.interval,
      hideHeader: runtime?.hideHeader,
      skipSplash: runtime?.skipSplash,
      logLevel: runtime?.logLevel,
    });
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

export async function runAnalyze(files: string[], options: AnalyzeOptions): Promise<void> {
  const caps = detectTerminalCapabilities();
  const mode = decideMode(options, caps);

  let result: AnalysisResult;

  if (mode === "tui" && caps.interactive) {
    result = await runWithAnalyzingAnimation(
      async () => {
        const input = await loadInput(files);
        const r = analyzeLocally({
          rawLines: input.lines,
          inputSources: input.sources,
          mode,
        });
        await maybeEnrichWithAi(r, options);
        return r;
      },
      { skipSplash: options.skipSplash, useAi: !options.noAi }
    );
  } else {
    const input = await loadInput(files);
    result = analyzeLocally({
      rawLines: input.lines,
      inputSources: input.sources,
      mode,
    });
    await maybeEnrichWithAi(result, options);
  }

  if (options.save) {
    const session = await saveSession(result, options.sessionName);
    result.diagnostics.warnings.push(`Saved session ${session.sessionId}`);
  }

  if (mode === "tui") {
    await runTuiWithFallback(result, {
      inspect: options.inspect,
      interval: options.interval,
      hideHeader: options.hideHeader,
      skipSplash: true,
      logLevel: options.logLevel,
    });
    return;
  }
  await renderAndPrint(result, mode);
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

  addAnalyzeOptions(
    program
      .command("analyze [files...]")
      .summary("Analyze logs from files/stdin")
      .description("Analyze file and stdin logs using the shared local engine and optional backend AI.")
      .addHelpText(
        "after",
        `
Examples:
  solidx analyze app.log
  solidx analyze api.log worker.log db.log
  cat incident.log | solidx analyze
  kubectl logs deploy/api -n prod | solidx analyze
  solidx analyze logs.txt --inspect --interval 2 --skip-splash
  solidx analyze logs.txt --json --no-ai
`
      )
      .action(async function (this: Command, files: string[]) {
    const opts = this.opts() as RawCommanderOptions;
    const normalized: AnalyzeOptions = {
      ...opts,
      noAi: opts.noAi ?? opts.ai === false,
      noTui: opts.noTui,
      logLevel: normalizeLogLevel((opts as { logLevel?: string }).logLevel),
    };
    await runAnalyze(files ?? [], normalized);
  })
  );

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
  const knownCommands = new Set(["analyze", "session", "export", "config", "completion"]);
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

