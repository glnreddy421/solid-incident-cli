import type { CanonicalEvent } from "../../utils/inputAdapters/types.js";
import type { CorrelatedGroup } from "./types.js";
import { scoreConfidence } from "./confidence.js";
import { eventIdOf, eventTime, linkageTokens } from "./utils.js";

const DEFAULT_BUCKET_MS = 30_000;

function groupIdentity(event: CanonicalEvent): string {
  const tokens = linkageTokens(event);
  if (tokens.length > 0) return tokens.join("|");
  return `${event.service ?? "unknown-service"}|${event.host ?? "unknown-host"}|${event.level ?? "info"}`;
}

export function groupCorrelatedEvents(events: CanonicalEvent[], bucketMs = DEFAULT_BUCKET_MS): CorrelatedGroup[] {
  const ordered = [...events].sort((a, b) => eventTime(a) - eventTime(b));
  const buckets = new Map<string, CanonicalEvent[]>();

  for (const event of ordered) {
    const bucket = Math.floor(eventTime(event) / bucketMs);
    const key = `${bucket}::${groupIdentity(event)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(event);
  }

  const groups: CorrelatedGroup[] = [];
  for (const [key, members] of buckets.entries()) {
    if (members.length < 2) continue;
    const sourceIds = [...new Set(members.map((e) => e.sourceId).filter(Boolean) as string[])];
    const services = [...new Set(members.map((e) => e.service).filter(Boolean) as string[])];
    const c = scoreConfidence({ events: members, base: 0.22, ambiguityPenalty: services.length > 1 ? 0.08 : 0.12 });
    const first = members[0];
    const last = members[members.length - 1];
    groups.push({
      id: `group-${key.replace(/[^a-zA-Z0-9]+/g, "-")}`,
      groupId: `group-${key.replace(/[^a-zA-Z0-9]+/g, "-")}`,
      key,
      eventIds: members.map((e) => eventIdOf(e)),
      relatedEventIds: members.map((e) => eventIdOf(e)),
      services,
      sourceIds,
      firstSeen: first.timestamp ?? first.receivedAt ?? new Date().toISOString(),
      lastSeen: last.timestamp ?? last.receivedAt ?? new Date().toISOString(),
      timeWindow: {
        start: first.timestamp ?? first.receivedAt ?? new Date().toISOString(),
        end: last.timestamp ?? last.receivedAt ?? new Date().toISOString(),
      },
      groupingReasons: [
        `bucket=${Math.floor(eventTime(first) / bucketMs)}`,
        "identity token overlap",
      ],
      confidence: c.confidence,
    });
  }

  return groups.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.id.localeCompare(b.id);
  });
}

