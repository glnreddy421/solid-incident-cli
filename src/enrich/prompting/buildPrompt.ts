import { readFile } from "fs/promises";
import { resolve } from "path";
import { STYLE_INSTRUCTIONS } from "./styles.js";
import { DEFAULT_SYSTEM_PROMPT } from "./systemPrompts.js";
import type { BuiltPrompt, PromptBuildOptions } from "../types.js";
import { safeSerializePayload } from "../payload/sanitizePayload.js";

async function readOptionalPromptFile(path: string | undefined): Promise<string | undefined> {
  if (!path) return undefined;
  const raw = await readFile(resolve(path), "utf8");
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function buildPrompt(options: PromptBuildOptions): Promise<BuiltPrompt> {
  const systemFromFile = await readOptionalPromptFile(options.systemPromptFile);
  const userFromFile = await readOptionalPromptFile(options.promptFile);

  const systemPrompt = options.systemPromptOverride ?? systemFromFile ?? DEFAULT_SYSTEM_PROMPT;
  if (options.userPromptOverride) {
    return {
      systemPrompt,
      userPrompt: options.userPromptOverride,
    };
  }

  if (userFromFile) {
    return {
      systemPrompt,
      userPrompt: userFromFile,
    };
  }

  const styleInstruction = STYLE_INSTRUCTIONS[options.style];
  const prior = options.priorNarrativeForFollowUp?.trim();
  const priorBlock = prior
    ? [
        "Prior operator analysis (anchor narrative — stay consistent unless structured facts below clearly contradict it):",
        prior,
        "",
      ].join("\n")
    : "";

  const userPrompt = [
    `Style: ${options.style}`,
    styleInstruction,
    "Rules:",
    "- The payload is pre-analyzed; you interpret and communicate — you do not replace the engine.",
    "- Use only provided evidence and diagnostics.",
    "- Do not invent unseen services, causes, timelines, or dependencies.",
    "- Mention uncertainty explicitly when confidence/coverage is low.",
    "- Incorporate ambiguity flags when present.",
    "- Ground recommended checks in supplied signals and evidence.",
    "- Keep output concise and shaped as requested by style (briefing = handoff prose, not a formal RCA PDF).",
    "",
    priorBlock,
    "Structured incident payload (facts):",
    safeSerializePayload(options.payload),
  ].join("\n");

  return {
    systemPrompt,
    userPrompt,
  };
}
