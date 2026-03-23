import { readFile } from "fs/promises";
import { resolve } from "path";
import { InputError } from "../contracts/errors.js";
import type { AnalysisResult } from "../contracts/model.js";

/**
 * Load analysis JSON as produced by `solidx analyze --json` (stdin `-` supported).
 */
export async function loadAnalysisJson(pathOrDash: string): Promise<AnalysisResult> {
  const raw =
    pathOrDash === "-"
      ? await (async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
          }
          return Buffer.concat(chunks).toString("utf8");
        })()
      : await readFile(resolve(pathOrDash), "utf8");

  if (!raw.trim()) {
    throw new InputError("EMPTY_INPUT", "Analysis JSON input is empty.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new InputError("MALFORMED_LOG", "Analysis input must be valid JSON.", String(error));
  }

  if (!parsed || typeof parsed !== "object") {
    throw new InputError("MALFORMED_LOG", "Analysis JSON must be an object.");
  }

  const candidate = parsed as Partial<AnalysisResult>;
  if (!candidate.assessment || !candidate.summary || !Array.isArray(candidate.timeline) || !candidate.schema) {
    throw new InputError(
      "MALFORMED_LOG",
      "Analysis JSON is missing required fields. Provide output produced by `solidx analyze --json`.",
    );
  }

  return candidate as AnalysisResult;
}
