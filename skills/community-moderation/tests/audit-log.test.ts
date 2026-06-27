import { describe, it, expect } from 'vitest';
import {
  AuditLogger,
  shouldLog,
  formatAuditEntry,
  eventKey,
  auditThumbnail,
  EVENT_CATEGORY,
  type AuditConfig,
  type AuditEvent,
} from '../examples/audit-log';

const base: AuditConfig = { enabled: true, channel: 'log', ignoredChannels: ['quiet'], dontLogBots: true, dontDisplayThumbnails: false };
const at = '2026-06-26T12:00:00.000Z';
const ev = (e: Partial<AuditEvent>): AuditEvent => ({ type: 'member_joined', at, ...e });

describe('audit-log — gating', () => {
  it('disabled config logs nothing', () =>
    expect(shouldLog(ev({}), { ...base, enabled: false })).toBe(false));

  it('logs an enabled event by default', () =>
    expect(shouldLog(ev({ type: 'member_joined' }), base)).toBe(true));

  it('respects a per-event toggle set to false', () => {
    const cfg = { ...base, events: { member: { memberJoined: false } } };
    expect(shouldLog(ev({ type: 'member_joined' }), cfg)).toBe(false);
    expect(shouldLog(ev({ type: 'member_left' }), cfg)).toBe(true); // sibling still on
  });

  it('dontLogBots skips bot actors', () => {
    expect(shouldLog(ev({ actor: { isBot: true } }), base)).toBe(false);
    expect(shouldLog(ev({ actor: { isBot: false } }), base)).toBe(true);
  });

  it('ignoredChannels skips message events there, not elsewhere', () => {
    expect(shouldLog(ev({ type: 'message_deleted', channelId: 'quiet' }), base)).toBe(false);
    expect(shouldLog(ev({ type: 'message_deleted', channelId: 'general' }), base)).toBe(true);
  });

  it('ignoredChannels does NOT suppress non-message events', () =>
    expect(shouldLog(ev({ type: 'member_joined', channelId: 'quiet' }), base)).toBe(true));
});

describe('audit-log — helpers', () => {
  it('eventKey camelCases the type', () => {
    expect(eventKey('member_muted')).toBe('memberMuted');
    expect(eventKey('member_joined_voice')).toBe('memberJoinedVoice');
    expect(eventKey('message_deleted')).toBe('messageDeleted');
  });

  it('every event type has a category', () =>
    expect(Object.keys(EVENT_CATEGORY).length).toBe(24));

  it('formats a readable entry without message content', () => {
    const line = formatAuditEntry(ev({ type: 'message_deleted', target: { handle: 'spammer' }, actor: { handle: 'agent' }, channelId: '123', reason: 'scam:seed-phrase' }));
    expect(line).toContain('🗑 Message deleted');
    expect(line).toContain('@spammer');
    expect(line).toContain('by @agent');
    expect(line).toContain('scam:seed-phrase');
  });

  it('formats a nickname change with old→new detail', () =>
    expect(formatAuditEntry(ev({ type: 'nickname_changed', target: { handle: 'kaue' }, detail: 'Kaue → Kaue|ST' }))).toContain('Kaue → Kaue|ST'));

  it('auditThumbnail honors dontDisplayThumbnails', () => {
    const e = ev({ target: { handle: 'x', avatarUrl: 'http://a/x.png' } });
    expect(auditThumbnail(e, base)).toBe('http://a/x.png');
    expect(auditThumbnail(e, { ...base, dontDisplayThumbnails: true })).toBeUndefined();
  });
});

describe('audit-log — AuditLogger dispatch', () => {
  it('sends gated events to the sink and skips suppressed ones', async () => {
    const sent: { channel: string; text: string }[] = [];
    const logger = new AuditLogger(base, (channel, text) => { sent.push({ channel, text }); });

    expect(await logger.log(ev({ type: 'member_joined', target: { handle: 'newbie' } }))).toBe(true);
    expect(await logger.log(ev({ type: 'member_joined', actor: { isBot: true } }))).toBe(false); // bot suppressed
    expect(await logger.log(ev({ type: 'message_deleted', channelId: 'quiet' }))).toBe(false); // ignored channel

    expect(sent).toHaveLength(1);
    expect(sent[0].channel).toBe('log');
    expect(sent[0].text).toContain('➕ Member joined');
  });
});
