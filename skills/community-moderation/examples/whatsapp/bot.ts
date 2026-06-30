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
import { InMemoryTicketStore, openTicketForUser, reopen, type TicketPanel } from '../ticketing';
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
  managerRoles: ['Moderator'],
  panelMessage: { title: 'Suporte', description: 'Atendimento via WhatsApp' },
  types: [{ id: 'duvida', label: 'Dúvida' }],
  introMessage: 'Olá {opener}! Recebemos sua mensagem e já vamos te ajudar.',
  maxOpenPerUser: 1,
  // publishChannel/openCategory/closedCategory omitted — Discord-only concepts (a guild
  // channel/category structure) this 1:1 platform has no equivalent of.
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

const MAX_BODY_BYTES = 1_000_000; // Cloud API webhook payloads are small JSON; 1MB is generous headroom

/** Reads the request body, rejecting (and destroying the socket) past MAX_BODY_BYTES — a
 * raw `node:http` server has no built-in payload cap, unlike grammY/discord.js's transports. */
function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('payload too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Strip control/escape characters (newlines, ANSI, etc.) so attacker-controlled webhook
// text can't forge or corrupt console/log lines once it flows into console.log below.
const stripControlChars = (s: string) => s.replace(/[\x00-\x1F\x7F]/g, '');

async function handleInbound(from: string, rawName: string | undefined, rawText: string, at: string): Promise<void> {
  const name = rawName ? stripControlChars(rawName) : rawName;
  const text = stripControlChars(rawText);

  let rec = await members.get(from);
  if (!rec) {
    rec = newMember(from, from, 'whatsapp', name);
    await members.upsert(rec);
  } else {
    await members.recordMessage(from, at);
  }
  events.record({ type: 'message', memberId: from, handle: from, displayName: name, at }); // no join/leave on WhatsApp — there's no group
  const ageDays = (Date.now() - Date.parse(rec.joinedAt)) / 86_400_000;

  if (looksLikeScamCheck(text)) {
    const findings = scanUrls(text, OFFICIAL_DOMAINS);
    const decision = moderateMessage({ text, memberTrust: rec.trustState, accountAgeDays: ageDays, officialDomains: OFFICIAL_DOMAINS });
    if (decision.escalate) console.log('WHATSAPP ESCALATE', { from, score: decision.score, reasons: decision.reasons });
    await sendWhatsAppText(from, formatScamCheckReply(decision, findings));
    return;
  }

  // Support path: the WhatsApp conversation IS the "channel" (channelId = the sender's
  // wa_id), and that id is permanent — reopen the existing ticket on a closed thread
  // instead of creating a new ticket record under the same channelId. Creating a second
  // ticket per channelId would make byChannel's "find the live one" ambiguous over time.
  const existing = await tickets.byChannel(from);
  if (!existing) {
    const opened = await openTicketForUser(tickets, WHATSAPP_PANEL, { id: from, handle: from });
    if (opened.ok && opened.ticket) {
      opened.ticket.channelId = from;
      await tickets.update(opened.ticket);
    }
  } else if (existing.status === 'closed') {
    reopen(existing, from);
    await tickets.update(existing);
  }
  // status 'open'/'claimed': nothing to do, the conversation continues on the live ticket.
  // status 'deleted' (rare, terminal — e.g. an admin tool nuked it for abuse): leave it;
  // a new inbound message does not resurrect a deleted ticket.
  const c = classifyMessage(text);
  const r = routeToPersona(c, routeConfig, { handle: from, trustState: rec.trustState }, text.slice(0, 140));
  console.log(r.handoff);
  await sendWhatsAppText(from, formatTicketAck(c.tag));
}

async function routeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
    let messages: ReturnType<typeof parseCloudApiWebhook> = [];
    try {
      messages = parseCloudApiWebhook(JSON.parse(raw));
    } catch (err) {
      console.error('webhook payload parse failed', err); // headers already sent; just stop, Meta saw 200 either way
      return;
    }
    for (const msg of messages) {
      await handleInbound(msg.from, msg.name, msg.text, msg.at).catch((err) => console.error('inbound handling failed', err));
    }
    return;
  }

  res.writeHead(404).end();
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  // A raw node:http server has no framework-level error boundary (unlike grammY/discord.js,
  // which catch handler errors for you) — without this, an aborted upload (readRawBody's
  // promise rejects) or any other thrown/rejected error becomes an unhandled rejection that
  // crashes the whole process on a single malformed request.
  routeRequest(req, res).catch((err) => {
    console.error('webhook request failed', err);
    if (!res.headersSent) res.writeHead(500).end();
    else if (!res.writableEnded) res.end();
  });
});
server.requestTimeout = 30_000; // no framework default here; bound a slow/stalled request
server.headersTimeout = 10_000;

server.listen(PORT, () => console.log(`WhatsApp support-intake webhook listening on :${PORT}/webhook`));
