import { stat, open } from "fs/promises";
import { watch, type FSWatcher } from "fs";
import type { FileTailOptions, LiveLine, LiveSourceState, SourceDescriptor } from "./types.js";

type OnLine = (line: LiveLine) => void;
type OnWarning = (warning: string) => void;

function nowIso(): string {
  return new Date().toISOString();
}

export class FileTailer {
  private readonly source: SourceDescriptor;
  private readonly options: Required<FileTailOptions>;
  private readonly onLine: OnLine;
  private readonly onWarning?: OnWarning;
  private state: LiveSourceState;
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lineNumber = 0;
  private reading = false;
  private running = false;

  constructor(source: SourceDescriptor, options: FileTailOptions, onLine: OnLine, onWarning?: OnWarning) {
    this.source = source;
    this.options = {
      fromStart: options.fromStart ?? false,
      pollIntervalMs: options.pollIntervalMs ?? 250,
    };
    this.onLine = onLine;
    this.onWarning = onWarning;
    this.state = {
      sourceId: source.sourceId,
      offsetBytes: 0,
      bufferedPartial: "",
      truncatedCount: 0,
      active: false,
    };
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.initializeOffset();
    this.state.active = true;
    this.timer = setInterval(() => {
      void this.readIncrement();
    }, this.options.pollIntervalMs);
    try {
      this.watcher = watch(this.source.sourcePath, () => {
        void this.readIncrement();
      });
    } catch {
      this.onWarning?.(`[${this.source.sourceName}] fs.watch unavailable; using polling only.`);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.state.active = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.watcher?.close();
    this.watcher = null;
    if (this.state.bufferedPartial.trim().length > 0) {
      this.emitLine(this.state.bufferedPartial);
      this.state.bufferedPartial = "";
    }
  }

  getState(): LiveSourceState {
    return { ...this.state };
  }

  private async initializeOffset(): Promise<void> {
    try {
      const st = await stat(this.source.sourcePath);
      this.state.inode = Number(st.ino);
      this.state.offsetBytes = this.options.fromStart ? 0 : st.size;
    } catch (error) {
      this.onWarning?.(`[${this.source.sourceName}] failed to stat source: ${String(error)}`);
      this.state.offsetBytes = 0;
    }
  }

  private async readIncrement(): Promise<void> {
    if (!this.running || this.reading) return;
    this.reading = true;
    try {
      const st = await stat(this.source.sourcePath);
      if (this.state.inode != null && Number(st.ino) !== this.state.inode) {
        this.onWarning?.(`[${this.source.sourceName}] rotation detected; resetting offset.`);
        this.state.inode = Number(st.ino);
        this.state.offsetBytes = 0;
        this.state.bufferedPartial = "";
      } else if (st.size < this.state.offsetBytes) {
        this.state.truncatedCount += 1;
        this.onWarning?.(`[${this.source.sourceName}] truncation detected; resetting offset.`);
        this.state.offsetBytes = 0;
        this.state.bufferedPartial = "";
      }
      if (st.size <= this.state.offsetBytes) return;

      const handle = await open(this.source.sourcePath, "r");
      try {
        const length = st.size - this.state.offsetBytes;
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, this.state.offsetBytes);
        this.state.offsetBytes = st.size;
        this.consumeChunk(buffer.toString("utf8"), st.size);
      } finally {
        await handle.close();
      }
    } catch (error) {
      this.onWarning?.(`[${this.source.sourceName}] read increment failed: ${String(error)}`);
    } finally {
      this.reading = false;
    }
  }

  private consumeChunk(chunk: string, fileSizeBytes: number): void {
    const merged = `${this.state.bufferedPartial}${chunk}`;
    const lines = merged.split(/\r?\n/);
    this.state.bufferedPartial = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      this.emitLine(line, fileSizeBytes);
    }
  }

  private emitLine(line: string, fileSizeBytes?: number): void {
    this.lineNumber += 1;
    this.onLine({
      sourceId: this.source.sourceId,
      sourceName: this.source.sourceName,
      sourcePath: this.source.sourcePath,
      sourceType: "file",
      receivedAt: nowIso(),
      line,
      lineNumber: this.lineNumber,
      offsetBytes: this.state.offsetBytes,
      fileSizeBytes,
    });
  }
}

