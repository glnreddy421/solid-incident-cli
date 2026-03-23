import type { AnalyzeFlags, AppMode, TerminalCapabilities } from "../contracts/index.js";
import { ModeError } from "../contracts/index.js";

export function detectTerminalCapabilities(): TerminalCapabilities {
  const stdinIsTty = process.stdin.isTTY === true;
  const stdoutIsTty = process.stdout.isTTY === true;
  const isCi = process.env.CI === "true" || process.env.CI === "1";
  const term = process.env.TERM;
  const supportsAnsi = stdoutIsTty && term !== "dumb";
  return {
    stdinIsTty,
    stdoutIsTty,
    interactive: stdinIsTty && stdoutIsTty && !isCi,
    isCi,
    term,
    supportsAnsi,
  };
}

function countExplicitOutputModes(flags: AnalyzeFlags): number {
  return [flags.json, flags.text, flags.md, flags.html].filter(Boolean).length;
}

export function decideMode(flags: AnalyzeFlags, caps: TerminalCapabilities): AppMode {
  const explicitOutputModeCount = countExplicitOutputModes(flags);
  if (explicitOutputModeCount > 1) {
    throw new ModeError("UNSUPPORTED_MODE_COMBINATION", "Only one output mode can be selected (--json/--text/--md/--html).");
  }

  if (flags.json) return "json";
  if (flags.md) return "markdown";
  if (flags.html) return "html";
  if (flags.text) return "text";
  if (flags.noTui) return "text";
  if (!caps.interactive) return "text";
  return "tui";
}

