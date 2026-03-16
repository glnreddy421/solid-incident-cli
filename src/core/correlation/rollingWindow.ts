import type { CanonicalEvent } from "../../utils/inputAdapters/types.js";

function timeOf(event: CanonicalEvent): number {
  const base = event.timestamp ?? event.receivedAt;
  if (!base) return Date.now();
  const parsed = new Date(base).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export class RollingEventWindow {
  private readonly windowMs: number;
  private readonly maxEvents: number;
  private events: CanonicalEvent[] = [];

  constructor(windowMs: number, maxEvents = 5000) {
    this.windowMs = windowMs;
    this.maxEvents = maxEvents;
  }

  add(event: CanonicalEvent): void {
    this.events.push(event);
    this.events.sort((a, b) => timeOf(a) - timeOf(b));
    this.evict();
  }

  getWindowMs(): number {
    return this.windowMs;
  }

  getAll(): CanonicalEvent[] {
    return [...this.events];
  }

  private evict(): void {
    if (this.events.length === 0) return;
    const newest = timeOf(this.events[this.events.length - 1]);
    const cutoff = newest - this.windowMs;
    this.events = this.events.filter((event) => timeOf(event) >= cutoff);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(this.events.length - this.maxEvents);
    }
  }
}

