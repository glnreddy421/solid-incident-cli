/**
 * Shared test helpers and factories for the diagnostics platform test suite.
 */
import type { RawLogLine } from "../../src/contracts/index.js";
import type { CanonicalEvent } from "../../src/utils/inputAdapters/types.js";

export function toRawLines(lines: string[], sourceName = "test.log"): RawLogLine[] {
  return lines.map((line, idx) => ({
    line,
    lineNumber: idx + 1,
    source: "file" as const,
    sourceName,
  }));
}

export function makeCanonicalEvent(
  partial: Partial<CanonicalEvent> & { id: string; timestamp: string; message: string },
): CanonicalEvent {
  return {
    type: "log",
    source: "test",
    sourceType: "file",
    sourceName: partial.sourceName ?? "test.log",
    sourcePath: partial.sourcePath ?? "/tmp/test.log",
    sourceId: partial.sourceId ?? "src-1",
    service: partial.service ?? "api",
    level: partial.level ?? "error",
    receivedAt: partial.timestamp,
    ...partial,
  };
}

export const LOG_FIXTURES = {
  k8s: "2024-03-08T14:02:11.123Z stdout F {\"level\":\"info\",\"msg\":\"Starting payment-service\",\"service\":\"payment-service\"}",
  json: '{"level":"error","msg":"connection refused","service":"payment-service","timestamp":"2024-03-08T14:02:12.456Z"}',
  syslog: "Mar 14 01:09:00 host api[91]: level=error msg=\"db timeout\" trace_id=abc",
  isoText: "2024-03-08T14:02:12.456Z service=api level=error msg=\"boom\"",
  keyValue: "level=error service=api msg=\"failed dependency\"",
  bracketed: "[2024-03-08T14:02:12Z] [error] [auth-service] service=auth msg=token expired",
  generic: "some random log line without structure",
} as const;
