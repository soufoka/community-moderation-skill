import { describe, it, expect } from 'vitest';
import { buildDirectory, toCSV, renderTable } from '../examples/member-directory';
import { newMember, type MemberRecord } from '../examples/member-store';
import type { GroupEvent } from '../examples/analytics';

const PERIOD = { from: '2026-06-20T00:00:00.000Z', to: '2026-06-27T00:00:00.000Z' }; // 7 days

function mk(id: string, handle: string, over: Partial<MemberRecord> = {}): MemberRecord {
  return { ...newMember(id, handle, 'telegram', over.displayName), ...over };
}

const members: MemberRecord[] = [
  mk('1', 'foka', {
    displayName: 'Foka',
    messageCount: 117,
    language: 'pt-br',
    trustState: 'TRUSTED',
    warnings: [
      { at: 'x', reason: '', signal: '', actor: 'agent' },
      { at: 'y', reason: '', signal: '', actor: 'agent' },
      { at: 'z', reason: '', signal: '', actor: 'agent' },
    ],
  }),
  mk('2', 'onix', { displayName: 'OnixFinance', messageCount: 0 }),
  mk('3', 'danny', { displayName: 'Danny', messageCount: 8, leftAt: '2026-06-26T16:48:00Z' }),
];

const events: GroupEvent[] = [
  { type: 'message', memberId: '1', at: '2026-06-22T14:00:00Z' },
  { type: 'message', memberId: '1', at: '2026-06-22T15:00:00Z' },
  { type: 'message', memberId: '1', at: '2026-06-23T09:00:00Z' },
  { type: 'message', memberId: '3', at: '2026-06-21T10:00:00Z' },
  { type: 'message', memberId: '1', at: '2026-05-01T10:00:00Z' }, // outside window — ignored
];

describe('member directory — aggregates', () => {
  const page = buildDirectory(members, events, PERIOD, { filter: 'all', sort: 'msga', tzOffsetMinutes: 0 });
  const foka = page.rows.find((r) => r.id === '1')!;

  it('counts period messages (MSG△), ignoring out-of-window', () => expect(foka.msga).toBe(3));
  it('counts active days as x/N', () => {
    expect(foka.activeDays).toBe(2); // 06-22 and 06-23
    expect(foka.windowDays).toBe(7);
  });
  it('carries warns, all-time messages, lang and trust (no XP)', () => {
    expect(foka.warns).toBe(3);
    expect(foka.msgAll).toBe(117);
    expect(foka.language).toBe('pt-br');
    expect(foka.trustState).toBe('TRUSTED');
    expect(foka).not.toHaveProperty('xp');
    expect(foka).not.toHaveProperty('reputation');
  });
  it('uses displayName as Name and handle as Username', () => {
    expect(foka.name).toBe('Foka');
    expect(foka.username).toBe('foka');
  });
});

describe('member directory — filter tabs', () => {
  it('current excludes members who left', () => {
    const p = buildDirectory(members, events, PERIOD, { filter: 'current' });
    expect(p.rows.map((r) => r.id).sort()).toEqual(['1', '2']);
    expect(p.counts).toEqual({ current: 2, left: 1, all: 3 });
  });
  it('left shows only members who left', () => {
    const p = buildDirectory(members, events, PERIOD, { filter: 'left' });
    expect(p.rows.map((r) => r.id)).toEqual(['3']);
  });
  it('all shows everyone', () =>
    expect(buildDirectory(members, events, PERIOD, { filter: 'all' }).total).toBe(3));
});

describe('member directory — sort & paginate', () => {
  it('sorts by period messages desc by default direction', () => {
    const p = buildDirectory(members, events, PERIOD, { filter: 'current', sort: 'msga' });
    expect(p.rows[0].id).toBe('1'); // 3 msgs
    expect(p.rows[1].id).toBe('2'); // 0 msgs
  });
  it('ascending when desc=false', () => {
    const p = buildDirectory(members, events, PERIOD, { filter: 'current', sort: 'msga', desc: false });
    expect(p.rows[0].id).toBe('2');
  });
  it('paginates', () => {
    const p1 = buildDirectory(members, events, PERIOD, { filter: 'current', sort: 'msga', perPage: 1, page: 1 });
    expect(p1.pages).toBe(2);
    expect(p1.rows).toHaveLength(1);
    expect(p1.rows[0].id).toBe('1');
    const p2 = buildDirectory(members, events, PERIOD, { filter: 'current', sort: 'msga', perPage: 1, page: 2 });
    expect(p2.rows[0].id).toBe('2');
  });
  it('clamps an out-of-range page', () =>
    expect(buildDirectory(members, events, PERIOD, { perPage: 1, page: 999 }).page).toBe(2));
});

describe('member directory — export & render (no XP)', () => {
  const rows = buildDirectory(members, events, PERIOD, { filter: 'all', sort: 'msga', tzOffsetMinutes: 0 }).rows;
  it('CSV header omits XP and includes the kept columns', () => {
    const header = toCSV(rows).split('\n')[0];
    expect(header).toBe('ID,Name,Username,MSG,AD,Warns,MSG(all),Last msg,Joined,Left,Lang,Trust');
    expect(header).not.toContain('XP');
  });
  it('CSV renders AD as x/N and the bare handle', () => {
    const fokaLine = toCSV(rows).split('\n').find((l) => l.startsWith('1,'))!;
    expect(fokaLine).toContain('foka');
    expect(fokaLine).toContain('2/7');
  });

  it('CSV neutralizes spreadsheet formula injection in a member-controlled name', () => {
    const evil = [{ ...newMember('9', 'x', 'telegram', '=HYPERLINK("http://evil")'), messageCount: 0 }];
    const line = toCSV(buildDirectory(evil, [], PERIOD, { filter: 'all' }).rows).split('\n')[1];
    // the formula cell must be defused with a leading apostrophe (and quoted for the comma)
    expect(line).toContain('"\'=HYPERLINK');
    expect(line).not.toMatch(/,=HYPERLINK/); // never a raw formula start
  });
  it('renderTable shows a header, names and trust', () => {
    const out = renderTable(rows);
    expect(out).toContain('Name');
    expect(out).toContain('Foka');
    expect(out).toContain('@foka');
    expect(out).toContain('TRUSTED');
    expect(out).not.toMatch(/\bXP\b/);
  });
});
