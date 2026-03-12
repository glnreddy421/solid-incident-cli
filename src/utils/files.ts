/**
 * File reading utilities with clear error handling.
 */

import { readFile } from "fs/promises";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import type { RawLogLine } from "./types.js";

export class FileNotFoundError extends Error {
  constructor(public path: string) {
    super(`Could not read file: ${path}`);
    this.name = "FileNotFoundError";
  }
}

export class EmptyFileError extends Error {
  constructor(public path: string) {
    super(`File is empty: ${path}`);
    this.name = "EmptyFileError";
  }
}

export async function readLogFile(filePath: string): Promise<RawLogLine[]> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("ENOENT")) throw new FileNotFoundError(filePath);
    throw new Error(`Could not read file: ${filePath}. ${message}`);
  }

  const trimmed = content.trim();
  if (!trimmed) throw new EmptyFileError(filePath);

  return trimmed.split("\n").map((line, i) => ({
    line,
    lineNumber: i + 1,
    source: "file" as const,
  }));
}

/** Read multiple log files and merge with source labels. Each line is prefixed with [filename] for correlation. */
export async function readLogFiles(filePaths: string[]): Promise<RawLogLine[]> {
  const results: RawLogLine[] = [];
  let globalLineNumber = 0;

  for (const filePath of filePaths) {
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("ENOENT")) throw new FileNotFoundError(filePath);
      throw new Error(`Could not read file: ${filePath}. ${message}`);
    }

    const trimmed = content.trim();
    if (!trimmed) continue;

    const label = filePath.split("/").pop() ?? filePath;
    for (const line of trimmed.split("\n")) {
      globalLineNumber++;
      results.push({
        line: `[${label}] ${line}`,
        lineNumber: globalLineNumber,
        source: "file",
      });
    }
  }

  if (results.length === 0) {
    throw new EmptyFileError(filePaths.length === 1 ? filePaths[0] : "all provided files");
  }

  return results;
}

export async function* readStdinLines(): AsyncGenerator<RawLogLine> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber++;
    yield { line, lineNumber, source: "stdin" };
  }
}

export function isStdinTty(): boolean {
  return process.stdin.isTTY === true;
}

/** Collect all lines from stdin into RawLogLine[]. Use when no files provided. */
export async function readStdinToLines(): Promise<RawLogLine[]> {
  const lines: RawLogLine[] = [];
  for await (const entry of readStdinLines()) {
    lines.push(entry);
  }
  return lines;
}
