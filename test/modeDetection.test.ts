import { describe, expect, it } from "vitest";
import { decideMode, detectTerminalCapabilities } from "../src/cli/mode.js";
import type { AnalyzeFlags, TerminalCapabilities } from "../src/contracts/index.js";

const interactiveCaps: TerminalCapabilities = {
  stdinIsTty: true,
  stdoutIsTty: true,
  interactive: true,
  isCi: false,
  term: "xterm-256color",
  supportsAnsi: true,
};

describe("mode detection", () => {
  it("detects terminal capabilities shape", () => {
    const caps = detectTerminalCapabilities();
    expect(typeof caps.stdinIsTty).toBe("boolean");
    expect(typeof caps.stdoutIsTty).toBe("boolean");
    expect(typeof caps.interactive).toBe("boolean");
  });

  it("forces non-tui with --no-tui", () => {
    const mode = decideMode({ noTui: true } as AnalyzeFlags, interactiveCaps);
    expect(mode).toBe("text");
  });

  it("defaults to tui in interactive terminals", () => {
    const mode = decideMode({} as AnalyzeFlags, interactiveCaps);
    expect(mode).toBe("tui");
  });

  it("uses json mode when --json flag is set", () => {
    const mode = decideMode({ json: true } as AnalyzeFlags, interactiveCaps);
    expect(mode).toBe("json");
  });

  it("falls back to text in non-interactive environment", () => {
    const mode = decideMode(
      {} as AnalyzeFlags,
      { ...interactiveCaps, interactive: false, stdinIsTty: false, stdoutIsTty: false, supportsAnsi: false }
    );
    expect(mode).toBe("text");
  });
});

