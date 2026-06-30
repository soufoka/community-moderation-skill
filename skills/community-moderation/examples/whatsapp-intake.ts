/**
 * WhatsApp support intake — pure core.
 *
 * SCOPE (read this first): WhatsApp has no API for reading or moderating GROUP
 * chats — not even the official Business Cloud API exposes that. There is no
 * compliant way to replicate the Telegram/Discord moderation pillar (delete,
 * mute, ban) on WhatsApp. What IS compliant and useful: a member DMs the
 * community's official WhatsApp Business number (1:1, member-initiated — exactly
 * the Cloud API's intended use), and the bot either (a) advisory-checks a
 * forwarded link/claim against the same scam scorer used elsewhere, or
 * (b) classifies the message and opens a support ticket via the shared
 * examples/ticketing.ts core. No group is ever read or acted on.
 *
 * Pure & dependency-light (only node:crypto, core Node, for signature
 * verification — deterministic, no I/O). The Cloud API webhook transport (HTTP
 * server, fetch calls) lives in examples/whatsapp/bot.ts.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Decision } from './moderate-message';
import { scanUrls, type UrlFinding } from './normalize';

export interface WhatsAppInboundMessage {
  id: string;
  from: string; // wa_id (phone number, no '+'), the stable member id on this platform
  name?: string; // contact profile name, if WhatsApp sent one
  text: string;
  at: string; // ISO, converted from the Cloud API's unix `timestamp` (seconds)
}

/**
 * Extract text messages from a Cloud API webhook POST body. Non-text payloads
 * (status callbacks, reactions, media, malformed/empty bodies) are skipped, not
 * thrown on — a webhook handler must never 500 on a shape it doesn't expect.
 */
export function parseCloudApiWebhook(body: unknown): WhatsAppInboundMessage[] {
  const out: WhatsAppInboundMessage[] = [];
  const entries = isRecord(body) && Array.isArray(body.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = isRecord(entry) && Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = isRecord(change) ? change.value : undefined;
      if (!isRecord(value)) continue;
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const nameByWaId = new Map<string, string>();
      for (const c of contacts) {
        if (isRecord(c) && typeof c.wa_id === 'string' && isRecord(c.profile) && typeof c.profile.name === 'string') {
          nameByWaId.set(c.wa_id, c.profile.name);
        }
      }
      const messages = Array.isArray(value.messages) ? value.messages : [];
      for (const m of messages) {
        if (!isRecord(m) || m.type !== 'text') continue; // media/reactions/etc. out of scope
        const text = isRecord(m.text) && typeof m.text.body === 'string' ? m.text.body : undefined;
        if (typeof m.id !== 'string' || typeof m.from !== 'string' || text === undefined) continue;
        const tsSec = Number(m.timestamp);
        const at = Number.isFinite(tsSec) ? new Date(tsSec * 1000).toISOString() : new Date().toISOString();
        out.push({ id: m.id, from: m.from, name: nameByWaId.get(m.from), text, at });
      }
    }
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

const SCAM_CHECK_PHRASES = [
  'is this a scam', 'is this real', 'is this legit', 'scam?', 'legit?',
  'isso e golpe', 'isso e real', 'e verdade isso', 'e seguro isso', 'golpe?',
  'esto es estafa', 'es real esto', 'es legitimo',
];

/**
 * Did the member forward a link/claim to be checked, vs. ask a normal support question?
 * URL presence is checked via scanUrls' own extraction (scheme'd, t.me/discord.gg-shaped,
 * and bare-domain links) rather than a separate regex — a naive `https?://` check misses
 * exactly the bare-domain/shortener shapes (`superteam.gift`, `t.me/...`) scammers use.
 */
export function looksLikeScamCheck(text: string): boolean {
  if (scanUrls(text).length > 0) return true;
  const s = text.toLowerCase();
  return SCAM_CHECK_PHRASES.some((p) => s.includes(p));
}

/** Render the advisory (no-action) reply for a scam-check request. */
export function formatScamCheckReply(decision: Decision, findings: UrlFinding[]): string {
  const suspicious = findings.filter((f) => f.suspicious);
  if (decision.score < 20 && suspicious.length === 0) {
    return (
      '✅ Não encontramos sinais óbvios de golpe nessa mensagem.\n' +
      'Mesmo assim: admins nunca pedem sua seed phrase nem chamam no PV primeiro. ' +
      'Na dúvida, confirme em um canal oficial antes de clicar ou enviar qualquer valor.'
    );
  }
  const reasons = decision.reasons.length ? decision.reasons.join(', ') : 'padrão suspeito';
  const hosts = suspicious.map((f) => f.host).join(', ');
  return (
    '⚠️ Isso tem cara de golpe.\n' +
    `Sinais: ${reasons}${hosts ? ` · domínio suspeito: ${hosts}` : ''}\n` +
    'Não clique no link, não conecte sua carteira e não compartilhe sua seed phrase. ' +
    'Encaminhamos isso para o time de moderação revisar.'
  );
}

/** Short ack reply when the message is routed into a support ticket instead. */
export function formatTicketAck(tag: string): string {
  return `Recebemos sua mensagem! Categoria: ${tag}. Nosso time vai te responder por aqui em breve.`;
}

/**
 * Verify a Cloud API webhook's `X-Hub-Signature-256: sha256=<hex>` header against
 * the RAW request body (hash before any JSON.parse — re-serializing can change
 * byte-for-byte equality and break this). Without this check, anyone who finds
 * your webhook URL could POST forged messages. Constant-time compare to avoid a
 * timing oracle on the signature.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined, appSecret: string): boolean {
  if (!signatureHeader || !appSecret) return false;
  const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
