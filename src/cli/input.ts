import { readFile } from "fs/promises";
import { createInterface } from "readline";
import type { InputSource, RawLogLine } from "../contracts/index.js";
import { InputError } from "../contracts/index.js";

export interface InputLoadResult {
  lines: RawLogLine[];
  sources: InputSource[];
}

async function readSingleFile(path: string): Promise<RawLogLine[]> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    throw new InputError("INVALID_FILE_PATH", `Could not read file: ${path}`, error instanceof Error ? error.message : String(error));
  }
  const rows = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return rows.map((line, idx) => ({ line, lineNumber: idx + 1, source: "file" }));
}

async function readStdin(): Promise<RawLogLine[]> {
  const lines: RawLogLine[] = [];
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber += 1;
    lines.push({ line, lineNumber, source: "stdin" });
  }
  return lines;
}

export async function loadInput(files: string[]): Promise<InputLoadResult> {
  const sources: InputSource[] = [];
  const lines: RawLogLine[] = [];

  if (files.length > 0) {
    for (const file of files) {
      const loaded = await readSingleFile(file);
      sources.push({ kind: "file", name: file });
      lines.push(...loaded);
    }
  } else if (process.stdin.isTTY !== true) {
    const loaded = await readStdin();
    sources.push({ kind: "stdin", name: "stdin" });
    lines.push(...loaded);
  } else {
    throw new InputError("NO_INPUT", "No input provided. Pass files or pipe logs into SOLID.");
  }

  if (lines.length === 0) {
    throw new InputError("EMPTY_INPUT", "No non-empty log lines were found in the provided input.");
  }

  return { lines, sources };
}

