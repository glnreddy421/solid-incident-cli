import { readFile } from "fs/promises";
import { createInterface } from "readline";
import type { InputSource, RawLogLine } from "../contracts/index.js";
import { InputError } from "../contracts/index.js";
import { ingestWithAdapters } from "../utils/inputAdapters/registry.js";
import type { CanonicalEvent } from "../utils/inputAdapters/types.js";

export interface InputLoadResult {
  lines: RawLogLine[];
  sources: InputSource[];
}

async function readSingleFile(path: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch (error) {
    throw new InputError("INVALID_FILE_PATH", `Could not read file: ${path}`, error instanceof Error ? error.message : String(error));
  }
}

async function readStdinAsBuffer(): Promise<{ content: string; sourceKind: "stdin" }> {
  const chunks: string[] = [];
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    chunks.push(line);
  }
  return { content: chunks.join("\n"), sourceKind: "stdin" };
}

/** Convert canonical events (HAR, PCAP) to synthetic log lines for engine compatibility */
function canonicalEventsToRawLines(events: CanonicalEvent[], sourceName: string): RawLogLine[] {
  return events.map((e, idx) => {
    const msg =
      e.type === "http"
        ? `${e.method ?? "?"} ${e.url ?? ""} ${e.statusCode ?? ""} ${e.latencyMs != null ? `${e.latencyMs}ms` : ""}`.trim()
        : e.message ?? e.raw ?? "event";
    const line = `[${e.timestamp ?? e.receivedAt ?? "unknown"}] ${e.service ?? e.type} ${e.level ?? "info"}: ${msg}`;
    return {
      line,
      lineNumber: idx + 1,
      source: "file" as const,
      sourceName,
    };
  });
}

export async function loadInput(files: string[]): Promise<InputLoadResult> {
  const sources: InputSource[] = [];
  const allLines: RawLogLine[] = [];
  let globalLineNumber = 0;

  if (files.length > 0) {
    for (const file of files) {
      const content = await readSingleFile(file);
      const result = ingestWithAdapters({
        content,
        context: { path: file, sourceName: file, sourceKind: "file" },
      });
      if (result.kind === "unsupported") {
        throw new InputError(
          "MALFORMED_LOG",
          `Input type not supported for ${file}. ${(result.warnings ?? []).join(" ")}`,
        );
      }
      sources.push({ kind: "file", name: file });
      if (result.kind === "text-lines" && result.lines?.length) {
        for (const line of result.lines) {
          globalLineNumber += 1;
          allLines.push({ ...line, lineNumber: globalLineNumber, source: "file" as const, sourceName: file });
        }
      } else if (result.kind === "canonical-events" && result.events.length) {
        const synthetic = canonicalEventsToRawLines(result.events, file);
        for (const line of synthetic) {
          globalLineNumber += 1;
          allLines.push({ ...line, lineNumber: globalLineNumber, source: "file" as const, sourceName: file });
        }
      } else if (result.kind === "canonical-events" && result.events.length === 0) {
        throw new InputError("EMPTY_INPUT", `No events extracted from ${file}. ${(result.warnings ?? []).join(" ")}`);
      }
    }
  } else if (process.stdin.isTTY !== true) {
    const { content, sourceKind } = await readStdinAsBuffer();
    const result = ingestWithAdapters({
      content,
      context: { sourceName: "stdin", sourceKind },
    });
    if (result.kind === "unsupported") {
      throw new InputError("MALFORMED_LOG", `Input type not supported. ${(result.warnings ?? []).join(" ")}`);
    }
    sources.push({ kind: "stdin", name: "stdin" });
    if (result.kind === "text-lines" && result.lines?.length) {
      for (const line of result.lines) {
        globalLineNumber += 1;
        allLines.push({ ...line, lineNumber: globalLineNumber, source: "stdin", sourceName: "stdin" });
      }
    } else if (result.kind === "canonical-events" && result.events.length) {
      const synthetic = canonicalEventsToRawLines(result.events, "stdin");
      for (const line of synthetic) {
        globalLineNumber += 1;
        allLines.push({ ...line, lineNumber: globalLineNumber, source: "stdin", sourceName: "stdin" });
      }
    } else if (result.kind === "canonical-events" && result.events.length === 0) {
      throw new InputError("EMPTY_INPUT", "No events extracted from stdin.");
    }
  } else {
    throw new InputError("NO_INPUT", "No input provided. Pass files or pipe logs into SOLID.");
  }

  if (allLines.length === 0) {
    throw new InputError("EMPTY_INPUT", "No non-empty log lines were found in the provided input.");
  }

  return { lines: allLines, sources };
}

