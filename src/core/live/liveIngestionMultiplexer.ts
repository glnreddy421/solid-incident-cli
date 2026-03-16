import { randomUUID } from "crypto";
import type { RawLogLine } from "../../contracts/index.js";
import { parseLines } from "../../utils/parser.js";
import type { CanonicalEvent } from "../../utils/inputAdapters/types.js";
import { FileTailer } from "./fileTailer.js";
import type { FileTailOptions, LiveIngestionResult, LiveLine, SourceDescriptor } from "./types.js";

export interface LiveIngestionMultiplexerOptions extends FileTailOptions {
  onWarning?: (warning: string) => void;
}

type EventListener = (result: LiveIngestionResult) => void;

export class LiveIngestionMultiplexer {
  private readonly tailers = new Map<string, FileTailer>();
  private readonly listeners = new Set<EventListener>();
  private readonly options: Required<LiveIngestionMultiplexerOptions>;

  constructor(options?: LiveIngestionMultiplexerOptions) {
    this.options = {
      fromStart: options?.fromStart ?? false,
      pollIntervalMs: options?.pollIntervalMs ?? 250,
      onWarning: options?.onWarning ?? (() => {}),
    };
  }

  onResult(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(sources: SourceDescriptor[]): Promise<void> {
    for (const source of sources) {
      const tailer = new FileTailer(
        source,
        { fromStart: this.options.fromStart, pollIntervalMs: this.options.pollIntervalMs },
        (line) => this.handleLine(line),
        this.options.onWarning,
      );
      this.tailers.set(source.sourceId, tailer);
      await tailer.start();
    }
  }

  async stop(): Promise<void> {
    const all = [...this.tailers.values()];
    this.tailers.clear();
    for (const tailer of all) {
      await tailer.stop();
    }
  }

  getSourceStates(): ReturnType<FileTailer["getState"]>[] {
    return [...this.tailers.values()].map((tailer) => tailer.getState());
  }

  private handleLine(liveLine: LiveLine): void {
    const raw: RawLogLine = {
      line: liveLine.line,
      lineNumber: liveLine.lineNumber,
      source: "file",
      sourceName: liveLine.sourceName,
    };
    const parsed = parseLines([raw]);
    const events: CanonicalEvent[] = parsed.map((event) => ({
      id: randomUUID(),
      type: "log",
      source: "live-tail",
      sourceId: liveLine.sourceId,
      sourceType: liveLine.sourceType,
      sourceName: liveLine.sourceName,
      sourcePath: liveLine.sourcePath,
      timestamp: event.timestamp !== "unknown" ? event.timestamp : undefined,
      receivedAt: liveLine.receivedAt,
      level: event.level ?? event.severity,
      message: event.message,
      service: event.service,
      host: event.host,
      pid: event.pid,
      namespace: event.namespace,
      pod: event.pod,
      container: event.container,
      traceId: event.traceId,
      spanId: event.spanId,
      attributes: event.attributes,
      raw: event.raw,
      sourceFields: event.sourceFields,
      parserId: event.parserId,
      parseConfidence: event.parseConfidence,
      parseReasons: event.parseReasons,
      parseWarnings: event.parseWarnings,
      adapterId: "text-log",
      adapterConfidence: 0.85,
      adapterReasons: ["live file line mapped through text parser registry"],
      diagnostics: {
        parser: {
          parserId: event.parserId,
          parseConfidence: event.parseConfidence,
          parseReasons: event.parseReasons,
          parseWarnings: event.parseWarnings,
        },
        adapter: {
          adapterId: "text-log",
          adapterConfidence: 0.85,
          adapterReasons: ["live file line mapped through text parser registry"],
        },
      },
    }));
    const result: LiveIngestionResult = {
      line: liveLine,
      events,
      warnings: events.length === 0 ? ["line did not produce parsed event"] : undefined,
    };
    for (const listener of this.listeners) listener(result);
  }
}

