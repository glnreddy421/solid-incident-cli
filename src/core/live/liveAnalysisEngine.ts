import { CorrelationService } from "../correlation/correlationService.js";
import type { CorrelationResult } from "../correlation/types.js";
import { LiveIngestionMultiplexer } from "./liveIngestionMultiplexer.js";
import type { LiveAnalysisOptions, SourceDescriptor } from "./types.js";

export interface LiveAnalysisController {
  stop: () => Promise<void>;
  getSnapshot: () => CorrelationResult;
}

export async function startLiveAnalysis(
  sources: SourceDescriptor[],
  options?: LiveAnalysisOptions,
): Promise<LiveAnalysisController> {
  const correlator = new CorrelationService(options?.windowMs ?? 5 * 60 * 1000);
  const multiplexer = new LiveIngestionMultiplexer({
    fromStart: options?.fromStart,
    pollIntervalMs: options?.pollIntervalMs,
    onWarning: options?.onWarning,
  });

  multiplexer.onResult((result) => {
    options?.onLine?.(result.line);
    if (result.warnings?.length) {
      for (const warning of result.warnings) options?.onWarning?.(warning);
    }
    for (const event of result.events) {
      options?.onEvent?.(event);
      const snapshot = correlator.ingest(event);
      for (const finding of snapshot.activeFindings) options?.onFinding?.(finding);
    }
  });

  await multiplexer.start(sources);

  return {
    stop: async () => {
      await multiplexer.stop();
    },
    getSnapshot: () => correlator.getSnapshot(),
  };
}

