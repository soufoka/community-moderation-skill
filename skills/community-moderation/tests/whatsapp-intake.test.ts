import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  parseCloudApiWebhook,
  looksLikeScamCheck,
  formatScamCheckReply,
  formatTicketAck,
  verifyWebhookSignature,
} from '../examples/whatsapp-intake';
import { moderateMessage } from '../examples/moderate-message';
import { scanUrls } from '../examples/normalize';

function textWebhook(text: string, opts: { from?: string; name?: string; id?: string; timestamp?: string } = {}) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ wa_id: opts.from ?? '5511999999999', profile: { name: opts.name ?? 'Foka' } }],
              messages: [
                {
                  id: opts.id ?? 'wamid.ABC123',
                  from: opts.from ?? '5511999999999',
                  timestamp: opts.timestamp ?? '1719500000',
                  type: 'text',
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe('parseCloudApiWebhook', () => {
  it('extracts a text message with its contact name', () => {
    const out = parseCloudApiWebhook(textWebhook('oi, preciso de ajuda'));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ from: '5511999999999', name: 'Foka', text: 'oi, preciso de ajuda', id: 'wamid.ABC123' });
    expect(out[0].at).toBe(new Date(1719500000 * 1000).toISOString());
  });

  it('ignores a status-update webhook (no messages key)', () => {
    const statusPayload = { entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.X', status: 'delivered' }] } }] }] };
    expect(parseCloudApiWebhook(statusPayload)).toEqual([]);
  });

  it('ignores non-text message types (image, reaction, …)', () => {
    const payload = { entry: [{ changes: [{ value: { messages: [{ id: 'm1', from: '551199', timestamp: '1', type: 'image', image: { id: 'x' } }] } }] }] };
    expect(parseCloudApiWebhook(payload)).toEqual([]);
  });

  it('never throws on malformed or empty bodies', () => {
    expect(parseCloudApiWebhook(null)).toEqual([]);
    expect(parseCloudApiWebhook(undefined)).toEqual([]);
    expect(parseCloudApiWebhook({})).toEqual([]);
    expect(parseCloudApiWebhook('not an object')).toEqual([]);
    expect(parseCloudApiWebhook({ entry: 'not-an-array' })).toEqual([]);
    expect(parseCloudApiWebhook({ entry: [{ changes: [{ value: { messages: [{ type: 'text' }] } }] }] })).toEqual([]); // missing id/from/text
  });

  it('falls back to a fresh timestamp if `timestamp` is unparseable', () => {
    const out = parseCloudApiWebhook(textWebhook('hi', { timestamp: 'not-a-number' }));
    expect(out).toHaveLength(1);
    expect(() => new Date(out[0].at).toISOString()).not.toThrow();
  });
});

describe('looksLikeScamCheck', () => {
  it('flags a message containing a URL', () => expect(looksLikeScamCheck('olha esse link https://scam.xyz/claim')).toBe(true));
  it('flags an explicit scam-check phrase (EN/PT/ES)', () => {
    expect(looksLikeScamCheck('is this a scam?')).toBe(true);
    expect(looksLikeScamCheck('isso e golpe?')).toBe(true);
    expect(looksLikeScamCheck('es real esto')).toBe(true);
  });
  it('does not flag a normal support question', () => expect(looksLikeScamCheck('como eu envio minha submissao da bounty?')).toBe(false));

  it('flags a scheme-less link (t.me/, discord.gg/, www.) the old naive https?:// regex missed', () => {
    // Regression: the original check was a naive /https?:\/\// regex, which missed exactly
    // the link shapes scammers favor on WhatsApp — Telegram/Discord invite shorthands and
    // bare www. links with no scheme.
    expect(looksLikeScamCheck('entra no grupo t.me/golpe123')).toBe(true);
    expect(looksLikeScamCheck('join discord.gg/totally-legit')).toBe(true);
    expect(looksLikeScamCheck('acessa www.superteam-claim.example')).toBe(true);
  });
  it('does not flag a bare, non-suspicious domain mention with no link marker (matches scanUrls’ own conservatism)', () => {
    // A plain word-with-dots and no scheme/www/shortener marker is deliberately NOT treated
    // as a link by scanUrls (avoids false positives on ordinary text) — looksLikeScamCheck
    // inherits that same, intentional selectivity rather than being more aggressive than it.
    expect(looksLikeScamCheck('confere o superteam.fun quando der')).toBe(false);
  });
});

describe('formatScamCheckReply', () => {
  it('reassures on a clean decision with no suspicious URLs', () => {
    const d = moderateMessage({ text: 'gm, tudo bem?', memberTrust: 'MEMBER', accountAgeDays: 30 });
    const out = formatScamCheckReply(d, []);
    expect(out).toMatch(/✅/);
    expect(out).not.toMatch(/⚠️/);
  });
  it('warns and lists reasons + the suspicious host on a flagged decision', () => {
    const text = 'claim here http://xn--pple-43d.com now';
    const findings = scanUrls(text);
    const d = moderateMessage({ text, memberTrust: 'NEW', accountAgeDays: 0 });
    const out = formatScamCheckReply(d, findings);
    expect(out).toMatch(/⚠️/);
    expect(out).toContain('xn--pple-43d.com');
  });
});

describe('formatTicketAck', () => {
  it('includes the classification tag', () => expect(formatTicketAck('wallet-help')).toContain('wallet-help'));
});

describe('verifyWebhookSignature', () => {
  const secret = 'shh-app-secret';
  const body = JSON.stringify({ hello: 'world' });
  const validSig = 'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex');

  it('accepts a correctly signed body', () => expect(verifyWebhookSignature(body, validSig, secret)).toBe(true));
  it('rejects a tampered body', () => expect(verifyWebhookSignature(body + 'x', validSig, secret)).toBe(false));
  it('rejects a wrong secret', () => expect(verifyWebhookSignature(body, validSig, 'wrong-secret')).toBe(false));
  it('rejects a missing signature header', () => expect(verifyWebhookSignature(body, undefined, secret)).toBe(false));
  it('rejects when appSecret is empty', () => expect(verifyWebhookSignature(body, validSig, '')).toBe(false));
});
