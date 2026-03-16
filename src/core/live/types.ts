import type { CanonicalEvent } from "../../utils/inputAdapters/types.js";

export interface SourceDescriptor {
  sourceId: string;
  sourceName: string;
  sourcePath: string;
  sourceType: "file";
}

export interface LiveSourceState {
  sourceId: string;
  offsetBytes: number;
  bufferedPartial: string;
  inode?: number;
  truncatedCount: number;
  active: boolean;
}

export interface LiveLine {
  sourceId: string;
  sourceName: string;
  sourcePath: string;
  sourceType: "file";
  receivedAt: string;
  line: string;
  lineNumber: number;
  offsetBytes?: number;
  fileSizeBytes?: number;
}

export interface LiveIngestionResult {
  line: LiveLine;
  events: CanonicalEvent[];
  warnings?: string[];
}

export interface FileTailOptions {
  fromStart?: boolean;
  pollIntervalMs?: number;
}

export interface LiveAnalysisOptions extends FileTailOptions {
  windowMs?: number;
  onEvent?: (event: CanonicalEvent) => void;
  onLine?: (line: LiveLine) => void;
  onWarning?: (warning: string) => void;
  onFinding?: (finding: import("../correlation/types.js").ActiveFinding) => void;
}

