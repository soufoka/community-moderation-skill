/**
 * Reference Telegram moderation bot (grammY) with full wiring: member store,
 * self rate-limit, idempotency, human-gated bans. Wire the store to your DB.
 *
 * Install: npm i grammy
 * Run:     BOT_TOKEN=... npx tsx bot.ts
 */
import { Bot } from 'grammy';
import { moderateMessage } from '../moderate-message';
import { classifyMessage, routeToPersona, RouteConfig } from '../classify-and-route';
import { InMemoryMemberStore, newMember } from '../member-store';
import { RateLimiter, IdempotencyStore } from '../rate-limiter';

const token = process.env.BOT_TOKEN;
if (!token) throw new Error('Set BOT_TOKEN in the environment (never hardcode it).');

const OFFICIAL_DOMAINS = ['superteam.fun', 'earn.superteam.fun'];
const routeConfig: RouteConfig = {
  defaultPersona: 'triage',
  defaultChannel: '#support',
  routes: { 'payout-issue': { persona: 'ops', channel: '#ops' } },
};

const members = new InMemoryMemberStore(); // swap for your DB-backed MemberStore
const actions = new RateLimiter(20, 20); // cap the agent's own actions/min
const seen = new IdempotencyStore();

const bot = new Bot(token);

bot.on('message:text', async (ctx) => {
  if (ctx.from?.is_bot) return; // self-guard: never act on other bots
  // idempotency — Telegram message_id is unique per CHAT, not globally, so scope by chat.
  if (!seen.firstSeen(`${ctx.chat?.id ?? ''}:${ctx.msg.message_id}`)) return;

  const id = String(ctx.from!.id);
  let rec = await members.get(id);
  if (!rec) {
    rec = newMember(id, ctx.from?.username ?? id, 'telegram');
    await members.upsert(rec);
  }
  const ageDays = (Date.now() - Date.parse(rec.joinedAt)) / 86_400_000;

  const decision = moderateMessage({
    text: ctx.msg.text,
    memberTrust: rec.trustState,
    accountAgeDays: ageDays,
    officialDomains: OFFICIAL_DOMAINS,
  });

  // Always remove flagged content (deletion is safe + reversible). Do NOT gate this on
  // the self rate-limiter, or a raid slips through once the bucket drains.
  if (decision.action === 'delete' || decision.action === 'mute') {
    await ctx.deleteMessage().catch(() => {});
    await members.recordWarning(id, { reason: decision.reasons.join(','), signal: decision.reasons[0] ?? 'n/a', actor: 'agent' });
  }
  // Mute is heavier — throttle it; if the limiter trips, escalate instead of mass-muting.
  if (decision.action === 'mute') {
    if (actions.allow()) {
      await ctx.restrictChatMember(ctx.from!.id, { can_send_messages: false }, { until_date: Math.floor(Date.now() / 1000) + 3600 }).catch(() => {});
    } else {
      console.log('CIRCUIT-BREAKER: mute rate exceeded — escalating instead', { user: ctx.from?.username });
    }
  }
  // ban/kick are irreversible — escalate to humans, never auto-execute.
  if (decision.escalate) {
    console.log('ESCALATE', { user: ctx.from?.username, score: decision.score, reasons: decision.reasons });
  }

  // Front-line support triage for clean messages.
  if (decision.action === 'allow') {
    const c = classifyMessage(ctx.msg.text);
    if (c.tag !== 'off-topic') {
      const r = routeToPersona(c, routeConfig, { handle: ctx.from?.username ?? id, trustState: rec.trustState }, ctx.msg.text.slice(0, 140));
      console.log(r.handoff);
    }
  }
});

bot.start();
