/**
 * Append-only group event log feeding analytics + the member directory.
 * Stores only {type, memberId, handle?, displayName?, at} — never message content.
 * In-memory reference impl with retention + a hard cap; swap for a DB table
 * (one row per event) in production.
 */
import type { GroupEvent } from './analytics';

export interface EventLog {
  record(e: GroupEvent): void;
  all(): GroupEvent[];
  since(fromMs: number): GroupEvent[];
}

const DAY_MS = 86_400_000;

export class InMemoryEventLog implements EventLog {
  private events: GroupEvent[] = [];

  constructor(
    private retentionDays = 90,
    private max = 500_000,
  ) {}

  record(e: GroupEvent): void {
    this.events.push(e);
    this.prune();
  }

  all(): GroupEvent[] {
    return this.events;
  }

  since(fromMs: number): GroupEvent[] {
    return this.events.filter((e) => Date.parse(e.at) >= fromMs);
  }

  /** Drop events older than the retention window; enforce the hard cap. Cheap amortized. */
  private prune(): void {
    const cutoff = Date.now() - this.retentionDays * DAY_MS;
    if (this.events.length && Date.parse(this.events[0].at) < cutoff) {
      this.events = this.events.filter((e) => Date.parse(e.at) >= cutoff);
    }
    if (this.events.length > this.max) {
      this.events = this.events.slice(this.events.length - this.max);
    }
  }
}
