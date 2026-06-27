import { describe, it, expect } from 'vitest';
import {
  applyContentFilters,
  detectTelegramFeatures,
  maxLengthFromConfig,
  ruleAction,
  CONTENT_FILTERS,
} from '../examples/content-filters';

describe('content filters — Combot parity', () => {
  it('catalog has all 27 Combot filters', () => expect(CONTENT_FILTERS.length).toBe(27));

  it('allows by default when config is empty', () =>
    expect(applyContentFilters(['stickers', 'gifs']).action).toBe('allow'));

  it('deletes a link when configured', () =>
    expect(applyContentFilters(['links'], { links: 'delete' }).action).toBe('delete'));

  it('"off" is treated as allow', () => {
    expect(ruleAction('off')).toBe('allow');
    expect(applyContentFilters(['messageLength'], { messageLength: { action: 'off', max: 0 } }).action).toBe('allow');
  });

  it('returns the strictest action across matched filters', () => {
    const d = applyContentFilters(['stickers', 'links'], { stickers: 'warn', links: 'mute' });
    expect(d.action).toBe('mute');
    expect(d.reasons).toContain('filter:links');
    expect(d.reasons).toContain('filter:stickers');
  });
});

describe('content filters — trust overrides', () => {
  it('NEW member: links blocked even when the filter allows', () =>
    expect(applyContentFilters(['links'], { links: 'allow' }, { memberTrust: 'NEW', newMemberNoLinks: true }).action).toBe('delete'));

  it('NEW member: media blocked even when the filter allows', () =>
    expect(applyContentFilters(['images'], { images: 'allow' }, { memberTrust: 'NEW', newMemberNoMedia: true }).action).toBe('delete'));

  it('FLAGGED member is treated like NEW', () =>
    expect(applyContentFilters(['gifs'], { gifs: 'allow' }, { memberTrust: 'FLAGGED', newMemberNoMedia: true }).action).toBe('delete'));

  it('TRUSTED member: no trust override applied', () =>
    expect(applyContentFilters(['links'], { links: 'allow' }, { memberTrust: 'TRUSTED', newMemberNoLinks: true }).action).toBe('allow'));

  it('an explicit filter action is not weakened by trust state', () =>
    expect(applyContentFilters(['gifs'], { gifs: 'mute' }, { memberTrust: 'NEW', newMemberNoMedia: true }).action).toBe('mute'));

  it('NEW member: a weaker base action (warn) is still upgraded to delete for links', () =>
    expect(applyContentFilters(['links'], { links: 'warn' }, { memberTrust: 'NEW', newMemberNoLinks: true }).action).toBe('delete'));

  it('NEW member: a weaker base action (warn) is upgraded to delete for media', () =>
    expect(applyContentFilters(['images'], { images: 'warn' }, { memberTrust: 'NEW', newMemberNoMedia: true }).action).toBe('delete'));
});

describe('content filters — Telegram feature detection', () => {
  it('detects stickers, forwards and edits', () => {
    const f = detectTelegramFeatures({ sticker: {}, forward_date: 123, edit_date: 456 });
    expect(f).toContain('stickers');
    expect(f).toContain('forwards');
    expect(f).toContain('editedMessages');
  });

  it('detects a link in plain text', () =>
    expect(detectTelegramFeatures({ text: 'see https://x.com' })).toContain('links'));

  it('detects a channel-sender post', () =>
    expect(detectTelegramFeatures({ sender_chat: { type: 'channel' } })).toContain('messagesFromChannels'));

  it('detects service messages', () =>
    expect(detectTelegramFeatures({ new_chat_members: [{}] })).toContain('serviceMessages'));

  it('flags over-length messages against max, ignores short ones', () => {
    expect(detectTelegramFeatures({ text: 'a'.repeat(50) }, { maxLength: 10 })).toContain('messageLength');
    expect(detectTelegramFeatures({ text: 'short' }, { maxLength: 10 })).not.toContain('messageLength');
  });

  it('passes through wordsFilter and duplicate opts', () => {
    const f = detectTelegramFeatures({ text: 'hi' }, { wordsHit: true, duplicate: true });
    expect(f).toContain('wordsFilter');
    expect(f).toContain('duplicateTextMessages');
  });

  it('maxLengthFromConfig reads the cap (and 0 when off)', () => {
    expect(maxLengthFromConfig({ messageLength: { action: 'delete', max: 1200 } })).toBe(1200);
    expect(maxLengthFromConfig({ messageLength: { action: 'off', max: 0 } })).toBe(0);
    expect(maxLengthFromConfig({})).toBe(0);
  });

  it('end-to-end: detect → filter a forwarded GIF for a new member', () => {
    const msg = { animation: {}, forward_date: 999 };
    const features = detectTelegramFeatures(msg);
    const d = applyContentFilters(features, { gifs: 'allow', forwards: 'allow' }, { memberTrust: 'NEW', newMemberNoMedia: true });
    expect(d.action).toBe('delete'); // gif blocked by newMemberNoMedia
    expect(d.reasons).toContain('filter:gifs');
  });
});
