/**
 * Reference WhatsApp support-intake bot — official WhatsApp Business Cloud API.
 *
 * SCOPE / COMPLIANCE (read resources/whatsapp-intake.md first): WhatsApp has no
 * API — official or otherwise — for reading or moderating a GROUP chat. This bot
 * does NOT do that and never will; it is a 1:1, member-initiated support/scam-check
 * channel, which is exactly what the Cloud API is for. It shares the same
 * ticketing/classify-and-route/member-store/event-log core as the Telegram and
 * Discord bots, so a member who DMs the official WhatsApp number gets the same
 * scam detection and support triage as someone posting in the group chats.
 *
 * Setup:
 *   1. Create a Meta App with the WhatsApp product, get a phone_number_id and a
 *      permanent access token (System User token), and your app secret.
 *   2. Point the app's webhook at this server's /webhook (e.g. via a tunnel in dev).
 *   3. Choose a WHATSAPP_VERIFY_TOKEN yourself; Meta echoes it back during setup.
 *
 * Run: WHATSAPP_TOKEN=... WHATSAPP_PHONE_ID=... WHATSAPP_VERIFY_TOKEN=... WHATSAPP_APP_SECRET=... npx tsx bot.ts
 */
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { moderateMessage } from '../moderate-message';
import { scanUrls } from '../normalize';
import { classifyMessage, routeToPersona, RouteConfig } from '../classify-and-route';
import { InMemoryMemberStore, newMember } from '../member-store';
import {
  parseCloudApiWebhook,
  looksLikeScamCheck,
  formatScamCheckReply,
  formatTicketAck,
  verifyWebhookSignature,
} from '../whatsapp-intake';
import { InMemoryTicketStore, openTicketForUser, type TicketPanel } from '../ticketing';
import { InMemoryEventLog } from '../event-log';

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const APP_SECRET = process.env.WHATSAPP_APP_SECRET;
const PORT = Number(process.env.PORT ?? 8787);
if (!TOKEN || !PHONE_ID || !VERIFY_TOKEN || !APP_SECRET) {
  throw new Error('Set WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET (never hardcode them).');
}

const OFFICIAL_DOMAINS = ['superteam.fun', 'earn.superteam.fun']; // from foka-config.json -> community.officialDomains
const routeConfig: RouteConfig = {
  defaultPersona: 'triage',
  defaultChannel: '#support',
  routes: { 'payout-issue': { persona: 'ops', channel: '#ops' } },
};
const WHATSAPP_PANEL: TicketPanel = {
  id: 'whatsapp-suporte',
  name: 'Superteam Suporte (WhatsApp)',
  publishChannel: 'whatsapp', // no real channel exists on this platform; required by TicketPanel, unused here
  managerRoles: ['Moderator'],
  panelMessage: { title: 'Suporte', description: 'Atendimento via WhatsApp' },
  types: [{ id: 'duvida', label: 'Dúvida' }],
  introMessage: 'Olá {opener}! Recebemos sua mensagem e já vamos te ajudar.',
  openCategory: '', // Discord-channel-category concept; not applicable on WhatsApp
  closedCategory: '',
  maxOpenPerUser: 1,
};

const members = new InMemoryMemberStore(); // swap for your DB-backed MemberStore
const tickets = new InMemoryTicketStore(); // swap for your DB-backed TicketStore
const events = new InMemoryEventLog(90); // shared with Telegram/Discord for unified analytics/roster

async function sendWhatsAppText(to: string, body: string): Promise<void> {
  await fetch(`https://graph.facebook.com/v21.0/${PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
  }).catch((err) => console.error('WhatsApp send failed', err)); // never let a reply failure crash the webhook handler
}

function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleInbound(from: string, name: string | undefined, text: string, at: string): Promise<void> {
  let rec = await members.get(from);
  if (!rec) {
    rec = newMember(from, from, 'whatsapp', name);
    await members.upsert(rec);
  } else {
    await members.recordMessage(from, at);
  }
  events.record({ type: 'message', memberId: from, handle: from, displayName: name, at }); // no join/leave on WhatsApp — there's no group

  if (looksLikeScamCheck(text)) {
    const findings = scanUrls(text, OFFICIAL_DOMAINS);
    const decision = moderateMessage({ text, memberTrust: rec.trustState, accountAgeDays: 0, officialDomains: OFFICIAL_DOMAINS });
    if (decision.escalate) console.log('WHATSAPP ESCALATE', { from, score: decision.score, reasons: decision.reasons });
    await sendWhatsAppText(from, formatScamCheckReply(decision, findings));
    return;
  }

  // Support path: reuse an existing open thread (the WhatsApp conversation IS the
  // channel — channelId = the sender's wa_id) instead of opening a new ticket per message.
  const existing = await tickets.byChannel(from);
  if (!existing || existing.status === 'closed' || existing.status === 'deleted') {
    const opened = await openTicketForUser(tickets, WHATSAPP_PANEL, { id: from, handle: from });
    if (opened.ok && opened.ticket) {
      opened.ticket.channelId = from;
      await tickets.update(opened.ticket);
    }
  }
  const c = classifyMessage(text);
  const r = routeToPersona(c, routeConfig, { handle: from, trustState: rec.trustState }, text.slice(0, 140));
  console.log(r.handoff);
  await sendWhatsAppText(from, formatTicketAck(c.tag));
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/webhook') {
    // Meta's one-time handshake when you register the webhook URL.
    if (url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === VERIFY_TOKEN) {
      res.writeHead(200).end(url.searchParams.get('hub.challenge') ?? '');
    } else {
      res.writeHead(403).end();
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/webhook') {
    const raw = await readRawBody(req);
    if (!verifyWebhookSignature(raw, req.headers['x-hub-signature-256'] as string | undefined, APP_SECRET)) {
      res.writeHead(401).end();
      return;
    }
    res.writeHead(200).end('ok'); // ack immediately; Meta retries on slow/failed responses
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return;
    }
    for (const msg of parseCloudApiWebhook(body)) {
      await handleInbound(msg.from, msg.name, msg.text, msg.at).catch((err) => console.error('inbound handling failed', err));
    }
    return;
  }

  res.writeHead(404).end();
});

server.listen(PORT, () => console.log(`WhatsApp support-intake webhook listening on :${PORT}/webhook`));
