/**
 * Member directory — Combot "Users" parity, WITHOUT XP.
 *
 * Joins MemberRecord data with per-member message aggregates over a period to
 * produce a sortable, filterable, paginated roster:
 *
 *   ID · Name · Username · MSG (period) · AD (active days x/N) · Warns ·
 *   MSG(all) · Last msg · Joined · Left · Lang · Trust
 *
 * (Combot's XP column is intentionally dropped — trust state is the moderation-
 * relevant signal here; per-member reputation stays in contact management.)
 *
 * Pure, dependency-free, deterministic. Privacy: reads ids/handles/timestamps and
 * message COUNTS — never message content.
 */
import type { MemberRecord } from './member-store';
import type { GroupEvent, Period } from './analytics';
import type { TrustState } from './moderate-message';

export type DirFilter = 'current' | 'all' | 'left';
export type DirSortKey = 'name' | 'msga' | 'activeDays' | 'warns' | 'msgAll' | 'lastMsg' | 'joined' | 'left';

export interface DirectoryRow {
  id: string;
  name: string; // displayName || handle || id
  username: string; // handle
  msga: number; // messages sent in the period (Combot "MSG△")
  activeDays: number; // distinct days active in the window (AD numerator)
  windowDays: number; // AD denominator → render as `activeDays/windowDays`
  warns: number;
  msgAll: number; // total messages all-time
  lastMsgAt?: string;
  joinedAt?: string;
  leftAt?: string;
  language?: string;
  trustState: TrustState;
}

export interface DirectoryOptions {
  filter?: DirFilter; // default 'current'
  sort?: DirSortKey; // default 'lastMsg'
  desc?: boolean; // default true
  page?: number; // 1-based, default 1
  perPage?: number; // default 50 (Combot default)
  tzOffsetMinutes?: number;
}

export interface DirectoryPage {
  rows: DirectoryRow[]; // current page, after filter + sort
  total: number; // rows matching the filter (before pagination)
  page: number;
  perPage: number;
  pages: number;
  counts: { current: number; left: number; all: number };
  period: Period;
}

const DAY_MS = 86_400_000;
const TRUST_RANK: Record<TrustState, number> = { BANNED: 0, MUTED: 1, FLAGGED: 2, NEW: 3, MEMBER: 4, TRUSTED: 5 };

interface Agg {
  msga: number;
  days: Set<number>;
  lastMsgAt?: string;
}

/** Build the roster for `period` from member records + the event log. */
export function buildDirectory(
  members: MemberRecord[],
  events: GroupEvent[],
  period: Period,
  opts: DirectoryOptions = {},
): DirectoryPage {
  const off = opts.tzOffsetMinutes ?? 0;
  const filter = opts.filter ?? 'current';
  const sort = opts.sort ?? 'lastMsg';
  const desc = opts.desc ?? true;
  const perPage = Math.max(1, opts.perPage ?? 50);
  const fromMs = Date.parse(period.from);
  const toMs = Date.parse(period.to);
  const windowDays = Math.max(1, Math.round((toMs - fromMs) / DAY_MS));

  // Per-member message aggregates within the window (single pass).
  const agg = new Map<string, Agg>();
  for (const e of events) {
    if (e.type !== 'message') continue;
    const ms = Date.parse(e.at);
    if (Number.isNaN(ms) || ms < fromMs || ms >= toMs) continue;
    let a = agg.get(e.memberId);
    if (!a) { a = { msga: 0, days: new Set() }; agg.set(e.memberId, a); }
    a.msga += 1;
    a.days.add(Math.floor((ms + off * 60_000) / DAY_MS));
    if (!a.lastMsgAt || ms > Date.parse(a.lastMsgAt)) a.lastMsgAt = e.at;
  }

  const allRows: DirectoryRow[] = members.map((m) => {
    const a = agg.get(m.id);
    return {
      id: m.id,
      name: m.displayName || m.handle || m.id,
      username: m.handle,
      msga: a?.msga ?? 0,
      activeDays: a?.days.size ?? 0,
      windowDays,
      warns: m.warnings?.length ?? 0,
      msgAll: m.messageCount ?? 0,
      lastMsgAt: a?.lastMsgAt ?? m.lastSeenAt,
      joinedAt: m.joinedAt,
      leftAt: m.leftAt,
      language: m.language,
      trustState: m.trustState,
    };
  });

  const counts = {
    current: allRows.filter((r) => !r.leftAt).length,
    left: allRows.filter((r) => r.leftAt).length,
    all: allRows.length,
  };

  const filtered = allRows.filter((r) =>
    filter === 'all' ? true : filter === 'left' ? !!r.leftAt : !r.leftAt,
  );

  filtered.sort((a, b) => cmp(a, b, sort) * (desc ? -1 : 1));

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(1, opts.page ?? 1), pages);
  const start = (page - 1) * perPage;

  return { rows: filtered.slice(start, start + perPage), total, page, perPage, pages, counts, period };
}

function ts(s?: string): number {
  const n = s ? Date.parse(s) : NaN;
  return Number.isNaN(n) ? -Infinity : n;
}

function cmp(a: DirectoryRow, b: DirectoryRow, key: DirSortKey): number {
  switch (key) {
    case 'name': return a.name.localeCompare(b.name);
    case 'msga': return a.msga - b.msga;
    case 'activeDays': return a.activeDays - b.activeDays;
    case 'warns': return a.warns - b.warns;
    case 'msgAll': return a.msgAll - b.msgAll;
    case 'joined': return ts(a.joinedAt) - ts(b.joinedAt);
    case 'left': return ts(a.leftAt) - ts(b.leftAt);
    case 'lastMsg':
    default: return ts(a.lastMsgAt) - ts(b.lastMsgAt);
  }
}

// ---- export & rendering ----

const CSV_HEADER = ['ID', 'Name', 'Username', 'MSG', 'AD', 'Warns', 'MSG(all)', 'Last msg', 'Joined', 'Left', 'Lang', 'Trust'];

function csvCell(v: string): string {
  let s = v ?? '';
  // Neutralize spreadsheet formula injection (CWE-1236): a member-controlled name like
  // "=HYPERLINK(...)" or "@SUM(...)" must not execute when the export is opened in Excel/Sheets.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Export the rows as CSV (Combot's "Export"), without the XP column. */
export function toCSV(rows: DirectoryRow[]): string {
  const lines = [CSV_HEADER.join(',')];
  for (const r of rows) {
    lines.push([
      r.id,
      r.name,
      r.username ?? '', // bare handle — CSV is data, not display (avoids a needless leading '@')
      String(r.msga),
      `${r.activeDays}/${r.windowDays}`,
      String(r.warns),
      String(r.msgAll),
      r.lastMsgAt ?? '',
      r.joinedAt ?? '',
      r.leftAt ?? '',
      r.language ?? '',
      r.trustState,
    ].map(csvCell).join(','));
  }
  return lines.join('\n');
}

function pad(s: string, n: number): string {
  s = s.length > n ? s.slice(0, n - 1) + '…' : s;
  return s.padEnd(n);
}
function padNum(s: string | number, n: number): string {
  return String(s).padStart(n);
}
function shortDate(iso?: string): string {
  return iso ? iso.slice(0, 10) : '—';
}

/** Monospaced roster table for chat (a compact column subset — full data is in toCSV). */
export function renderTable(rows: DirectoryRow[]): string {
  const head =
    pad('Name', 18) + ' ' + pad('Username', 14) + ' ' +
    padNum('MSG', 4) + ' ' + padNum('AD', 4) + ' ' + padNum('Wrn', 3) + ' ' +
    padNum('All', 5) + ' ' + pad('Last', 10) + ' ' + 'Trust';
  const sep = '-'.repeat(head.length);
  const body = rows.map((r) =>
    pad(r.name, 18) + ' ' +
    pad(r.username ? '@' + r.username.replace(/^@/, '') : '—', 14) + ' ' +
    padNum(r.msga, 4) + ' ' +
    padNum(`${r.activeDays}/${r.windowDays}`, 4) + ' ' +
    padNum(r.warns, 3) + ' ' +
    padNum(r.msgAll, 5) + ' ' +
    pad(shortDate(r.lastMsgAt), 10) + ' ' +
    r.trustState,
  );
  return [head, sep, ...body].join('\n');
}
