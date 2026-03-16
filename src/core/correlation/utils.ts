import type { CanonicalEvent } from "../../utils/inputAdapters/types.js";

export function eventTime(event: CanonicalEvent): number {
  const t = event.timestamp ?? event.receivedAt;
  const parsed = t ? new Date(t).getTime() : Date.now();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function eventIdOf(event: CanonicalEvent): string {
  return event.id ?? `${event.sourceId ?? "src"}-${event.receivedAt ?? event.timestamp ?? "now"}`;
}

export function toEvidence(events: CanonicalEvent[]): Array<{ eventId: string; sourceId?: string; service?: string; timestamp?: string }> {
  return events.map((event) => ({
    eventId: eventIdOf(event),
    sourceId: event.sourceId,
    service: event.service,
    timestamp: event.timestamp ?? event.receivedAt,
  }));
}

export function corroborationFor(sourceIds: string[]): "single-source-inferred" | "multi-source-corroborated" {
  return new Set(sourceIds).size >= 2 ? "multi-source-corroborated" : "single-source-inferred";
}

export function linkageTokens(event: CanonicalEvent): string[] {
  return [
    event.service,
    event.host,
    event.namespace,
    event.pod,
    event.container,
    event.traceId,
    event.spanId,
    event.requestId,
    event.method,
    event.url,
    event.protocol,
    event.srcIp,
    event.dstIp,
    event.srcPort != null ? String(event.srcPort) : undefined,
    event.dstPort != null ? String(event.dstPort) : undefined,
  ].filter((x): x is string => Boolean(x && x.trim()));
}

