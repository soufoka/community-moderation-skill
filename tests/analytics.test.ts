import { describe, it, expect } from 'vitest';
import {
  buildReport,
  pctChange,
  previousPeriod,
  heatmapPeak,
  formatReport,
  renderHeatmap,
  type GroupEvent,
} from '../examples/analytics';

const PERIOD = { from: '2026-06-20T00:00:00.000Z', to: '2026-06-27T00:00:00.000Z' }; // 7 days

function ev(type: GroupEvent['type'], memberId: string, at: string, extra: Partial<GroupEvent> = {}): GroupEvent {
  return { type, memberId, at, ...extra };
}

describe('pctChange — Combot parity', () => {
  it('matches the dashboard numbers', () => {
    expect(pctChange(2, 8)).toBeCloseTo(-75);
    expect(pctChange(2, 3)).toBeCloseTo(-33.3333, 3);
    expect(pctChange(106, 58)).toBeCloseTo(82.7586, 3);
    expect(pctChange(22, 17)).toBeCloseTo(29.4118, 3);
  });
  it('handles a zero baseline', () => {
    expect(pctChange(5, 0)).toBeNull(); // new — no baseline
    expect(pctChange(0, 0)).toBe(0);
  });
});

describe('previousPeriod', () => {
  it('is the equal-length window immediately before', () => {
    const p = previousPeriod(PERIOD);
    expect(p.to).toBe(PERIOD.from);
    expect(p.from).toBe('2026-06-13T00:00:00.000Z');
  });
});

describe('buildReport', () => {
  const events: GroupEvent[] = [
    // current window
    ev('join', 'a', '2026-06-22T16:11:00Z', { handle: 'OnixFinance' }),
    ev('join', 'b', '2026-06-22T21:18:00Z', { handle: 'MetEngine' }),
    ev('leave', 'b', '2026-06-22T21:30:00Z', { handle: 'MetEngine' }),
    ev('leave', 'c', '2026-06-26T16:48:00Z', { handle: 'maldanny_1', displayName: 'Danny' }),
    ev('message', 'a', '2026-06-22T14:00:00Z'),
    ev('message', 'a', '2026-06-22T14:30:00Z'),
    ev('message', 'd', '2026-06-23T09:00:00Z'),
    // previous window (2026-06-13 .. 2026-06-20)
    ev('join', 'x', '2026-06-15T10:00:00Z'),
    ev('message', 'x', '2026-06-15T10:01:00Z'),
    // outside both windows — must be ignored
    ev('message', 'z', '2026-05-01T00:00:00Z'),
  ];

  const r = buildReport(events, PERIOD, { tzOffsetMinutes: 0, lastN: 5 });

  it('counts joins/leaves/messages in the current window', () => {
    expect(r.joined.value).toBe(2);
    expect(r.left.value).toBe(2);
    expect(r.messages.value).toBe(3);
  });

  it('compares against the previous window', () => {
    expect(r.joined.previous).toBe(1);
    expect(r.messages.previous).toBe(1);
    expect(r.joined.deltaPct).toBeCloseTo(100); // 2 vs 1
  });

  it('net growth = joined - left', () => expect(r.netGrowth.value).toBe(0));

  it('active users are unique senders', () => {
    expect(r.activeUsers.value).toBe(2); // a, d
    expect(r.activeUsers.previous).toBe(1); // x
  });

  it('avg daily messages = messages / days', () => expect(r.avgDailyMessages).toBe(0)); // 3/7 → 0 (rounded)

  it('last joined / last left are most-recent-first', () => {
    expect(r.lastJoined.map((m) => m.handle)).toEqual(['MetEngine', 'OnixFinance']);
    expect(r.lastLeft[0].displayName).toBe('Danny'); // 06-26 is the most recent leave
  });

  it('ignores events outside both windows', () => {
    // 'z' message on 2026-05-01 must not inflate anything
    expect(r.messages.value + r.messages.previous).toBe(4);
  });

  it('places messages in the right heatmap cell', () => {
    // 2026-06-22 is a Monday (dow=1); two messages at 14:00 UTC
    expect(r.heatmap[1][14]).toBe(2);
    // 2026-06-23 Tuesday (dow=2) 09:00
    expect(r.heatmap[2][9]).toBe(1);
  });
});

describe('timezone bucketing', () => {
  it('shifts the day/hour by the offset', () => {
    const events = [ev('message', 'a', '2026-06-22T01:00:00Z')]; // 01:00 UTC Monday
    const utc = buildReport(events, PERIOD, { tzOffsetMinutes: 0 });
    expect(utc.heatmap[1][1]).toBe(1); // Monday 01:00
    const brt = buildReport(events, PERIOD, { tzOffsetMinutes: -180 }); // UTC-3 → Sunday 22:00
    expect(brt.heatmap[0][22]).toBe(1);
  });
});

describe('heatmapPeak', () => {
  it('finds the busiest cell', () => {
    const events = [
      ev('message', 'a', '2026-06-22T14:00:00Z'),
      ev('message', 'b', '2026-06-22T14:10:00Z'),
      ev('message', 'c', '2026-06-23T09:00:00Z'),
    ];
    const r = buildReport(events, PERIOD, { tzOffsetMinutes: 0 });
    expect(heatmapPeak(r.heatmap)).toEqual({ dow: 1, hour: 14, count: 2 });
  });
  it('returns a zero cell for an empty grid', () =>
    expect(heatmapPeak(buildReport([], PERIOD).heatmap).count).toBe(0));
});

describe('rendering', () => {
  const r = buildReport(
    [ev('join', 'a', '2026-06-22T16:00:00Z', { handle: 'OnixFinance' }), ev('message', 'a', '2026-06-22T14:00:00Z')],
    PERIOD,
    { tzOffsetMinutes: 0 },
  );
  it('formatReport shows tiles and signed deltas', () => {
    const out = formatReport(r);
    expect(out).toContain('Joined: 1');
    expect(out).toContain('Last joined: @OnixFinance');
    expect(out).toMatch(/Messages: 1 \((\+|new|-)/);
  });
  it('renderHeatmap is a 7-row grid plus an axis', () => {
    const lines = renderHeatmap(r.heatmap).split('\n');
    expect(lines.length).toBe(8); // axis + 7 days
    expect(lines[1].startsWith('SUN')).toBe(true);
    expect(lines[7].startsWith('SAT')).toBe(true);
  });
});

describe('empty window is safe', () => {
  it('returns zeros, no divide-by-zero', () => {
    const r = buildReport([], PERIOD);
    expect(r.messages.value).toBe(0);
    expect(r.messages.deltaPct).toBe(0);
    expect(r.avgDAU).toBe(0);
    expect(r.avgDailyMessages).toBe(0);
    expect(r.lastJoined).toEqual([]);
  });
});
