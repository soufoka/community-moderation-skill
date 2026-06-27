import { describe, it, expect } from 'vitest';
import { InMemoryEventLog } from '../examples/event-log';
import type { GroupEvent } from '../examples/analytics';

const now = Date.now();
const ev = (type: GroupEvent['type'], at: number): GroupEvent => ({ type, memberId: 'u', at: new Date(at).toISOString() });

describe('InMemoryEventLog', () => {
  it('records and returns all events', () => {
    const log = new InMemoryEventLog();
    log.record(ev('message', now));
    log.record(ev('join', now));
    expect(log.all()).toHaveLength(2);
  });

  it('since() filters by timestamp', () => {
    const log = new InMemoryEventLog();
    log.record(ev('message', now - 10 * 86_400_000));
    log.record(ev('message', now));
    expect(log.since(now - 86_400_000)).toHaveLength(1);
  });

  it('prunes events older than the retention window', () => {
    const log = new InMemoryEventLog(1); // 1-day retention
    log.record(ev('message', now - 5 * 86_400_000)); // old
    log.record(ev('message', now)); // fresh — triggers prune of the old head
    expect(log.all()).toHaveLength(1);
    expect(Date.parse(log.all()[0].at)).toBeGreaterThan(now - 86_400_000);
  });

  it('enforces the hard cap', () => {
    const log = new InMemoryEventLog(90, 3);
    for (let i = 0; i < 10; i++) log.record(ev('message', now + i));
    expect(log.all().length).toBeLessThanOrEqual(3);
  });
});
