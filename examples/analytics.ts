/**
 * Group analytics — Combot "Analytics" parity.
 *
 * Aggregates a stream of group EVENTS (join / leave / message) into a period
 * report: joins, leaves, net growth, messages, active users, average DAU and
 * daily messages, last-joined / last-left lists, and a day-of-week × hour
 * activity heatmap — each compared against the immediately preceding window
 * (% change), exactly like the Combot dashboard.
 *
 * Pure, dependency-free, deterministic. PRIVACY: it reads only an event's type,
 * member id and timestamp — never message content (see resources/security.md).
 */

export type GroupEventType = 'join' | 'leave' | 'message';

export interface GroupEvent {
  type: GroupEventType;
  memberId: string;
  handle?: string;
  displayName?: string;
  at: string; // ISO timestamp
}

export interface Period {
  from: string; // ISO, inclusive
  to: string; // ISO, exclusive
}

export interface Metric {
  value: number;
  previous: number;
  deltaPct: number | null; // null = no baseline (previous was 0 but current > 0)
}

export interface RecentMember {
  memberId: string;
  handle?: string;
  displayName?: string;
  at: string;
}

export interface AnalyticsReport {
  period: Period;
  previousPeriod: Period;
  joined: Metric;
  left: Metric;
  netGrowth: Metric; // joined - left
  messages: Metric;
  activeUsers: Metric; // unique members who sent ≥1 message in the period
  avgDAU: number; // mean daily unique active users across the window
  avgDailyMessages: number;
  lastJoined: RecentMember[];
  lastLeft: RecentMember[];
  heatmap: number[][]; // [7 days-of-week (0=Sun)] × [24 hours] message counts
}

export interface AnalyticsOptions {
  tzOffsetMinutes?: number; // timezone for daily/heatmap bucketing (e.g. -180 = UTC-3 / BRT)
  lastN?: number; // size of last-joined / last-left lists (default 5)
}

const DAY_MS = 86_400_000;

/** Combot-style percentage change. Returns null when there is no baseline (prev 0, curr > 0). */
export function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null;
  return ((curr - prev) / prev) * 100;
}

function metric(value: number, previous: number): Metric {
  return { value, previous, deltaPct: pctChange(value, previous) };
}

/** Shift a UTC epoch by the configured tz offset, then read UTC parts — deterministic, no Intl. */
function shifted(ms: number, offMin: number): Date {
  return new Date(ms + offMin * 60_000);
}
function dayKey(ms: number, offMin: number): number {
  return Math.floor((ms + offMin * 60_000) / DAY_MS);
}

/** The equal-length window immediately preceding `period`. */
export function previousPeriod(period: Period): Period {
  const fromMs = Date.parse(period.from);
  const toMs = Date.parse(period.to);
  const span = Math.max(DAY_MS, toMs - fromMs);
  return { from: new Date(fromMs - span).toISOString(), to: period.from };
}

function topRecent(evts: GroupEvent[], n: number): RecentMember[] {
  return [...evts]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, n)
    .map((e) => ({ memberId: e.memberId, handle: e.handle, displayName: e.displayName, at: e.at }));
}

/**
 * Build the full analytics report for `period` from a flat event list.
 * Events outside the current and previous windows are ignored. Single pass.
 */
export function buildReport(events: GroupEvent[], period: Period, opts: AnalyticsOptions = {}): AnalyticsReport {
  const off = opts.tzOffsetMinutes ?? 0;
  const lastN = opts.lastN ?? 5;

  const fromMs = Date.parse(period.from);
  const toMs = Date.parse(period.to);
  const span = Math.max(DAY_MS, toMs - fromMs);
  const prevFromMs = fromMs - span;

  let joined = 0, left = 0, messages = 0;
  let pJoined = 0, pLeft = 0, pMessages = 0;
  const active = new Set<string>();
  const pActive = new Set<string>();
  const joins: GroupEvent[] = [];
  const leaves: GroupEvent[] = [];
  const heatmap: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const dailyActive = new Map<number, Set<string>>(); // dayKey → unique members that day

  for (const e of events) {
    const ms = Date.parse(e.at);
    if (Number.isNaN(ms)) continue;

    if (ms >= fromMs && ms < toMs) {
      if (e.type === 'join') { joined++; joins.push(e); }
      else if (e.type === 'leave') { left++; leaves.push(e); }
      else if (e.type === 'message') {
        messages++;
        active.add(e.memberId);
        const d = shifted(ms, off);
        heatmap[d.getUTCDay()][d.getUTCHours()]++;
        const k = dayKey(ms, off);
        let day = dailyActive.get(k);
        if (!day) { day = new Set(); dailyActive.set(k, day); }
        day.add(e.memberId);
      }
    } else if (ms >= prevFromMs && ms < fromMs) {
      if (e.type === 'join') pJoined++;
      else if (e.type === 'leave') pLeft++;
      else if (e.type === 'message') { pMessages++; pActive.add(e.memberId); }
    }
  }

  const numDays = Math.max(1, Math.round(span / DAY_MS));
  // Average DAU: mean of daily unique active members across every day in the window
  // (days with zero activity count as 0).
  const startK = dayKey(fromMs, off);
  const endK = dayKey(toMs - 1, off);
  let sumDAU = 0;
  for (let k = startK; k <= endK; k++) sumDAU += dailyActive.get(k)?.size ?? 0;
  const avgDAU = Math.round(sumDAU / Math.max(1, endK - startK + 1));

  return {
    period,
    previousPeriod: { from: new Date(prevFromMs).toISOString(), to: period.from },
    joined: metric(joined, pJoined),
    left: metric(left, pLeft),
    netGrowth: metric(joined - left, pJoined - pLeft),
    messages: metric(messages, pMessages),
    activeUsers: metric(active.size, pActive.size),
    avgDAU,
    avgDailyMessages: Math.round(messages / numDays),
    lastJoined: topRecent(joins, lastN),
    lastLeft: topRecent(leaves, lastN),
    heatmap,
  };
}

/** The busiest heatmap cell — handy for "most active: TUE 14:00". */
export function heatmapPeak(heatmap: number[][]): { dow: number; hour: number; count: number } {
  let best = { dow: 0, hour: 0, count: 0 };
  for (let d = 0; d < heatmap.length; d++) {
    for (let h = 0; h < heatmap[d].length; h++) {
      if (heatmap[d][h] > best.count) best = { dow: d, hour: h, count: heatmap[d][h] };
    }
  }
  return best;
}

// ---- Rendering (so an agent can present the dashboard in chat) ----

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const SHADES = [' ', '·', '░', '▒', '▓', '█'];

function signPct(p: number | null): string {
  if (p === null) return 'new';
  return (p >= 0 ? '+' : '') + p.toFixed(2) + '%';
}

/** Headline summary, one card per line — mirrors the Combot dashboard tiles. */
export function formatReport(r: AnalyticsReport): string {
  const line = (label: string, m: Metric) => `${label}: ${m.value} (${signPct(m.deltaPct)}, prev ${m.previous})`;
  const lines = [
    `📊 ${r.period.from.slice(0, 10)} → ${r.period.to.slice(0, 10)}`,
    line('Joined', r.joined),
    line('Left', r.left),
    line('Net growth', r.netGrowth),
    line('Messages', r.messages),
    line('Active users', r.activeUsers),
    `Avg DAU: ${r.avgDAU} · Avg daily msgs: ${r.avgDailyMessages}`,
  ];
  const name = (m: RecentMember) => (m.handle ? '@' + m.handle.replace(/^@/, '') : m.displayName ?? m.memberId);
  if (r.lastJoined.length) lines.push('Last joined: ' + r.lastJoined.map(name).join(', '));
  if (r.lastLeft.length) lines.push('Last left: ' + r.lastLeft.map(name).join(', '));
  return lines.join('\n');
}

/** ASCII activity heatmap — rows are days-of-week, columns are hours 0–23, shaded by volume. */
export function renderHeatmap(heatmap: number[][]): string {
  const max = Math.max(1, ...heatmap.flat());
  const axis =
    '     ' +
    Array.from({ length: 24 }, (_, h) => (h % 6 === 0 ? String(h).padEnd(6) : '')).join('').slice(0, 24);
  const rows = heatmap.map((row, d) => {
    const cells = row
      .map((c) => SHADES[c === 0 ? 0 : Math.min(SHADES.length - 1, Math.ceil((c / max) * (SHADES.length - 1)))])
      .join('');
    return `${DOW[d]}  ${cells}`;
  });
  return [axis, ...rows].join('\n');
}
