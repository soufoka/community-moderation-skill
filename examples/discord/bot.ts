/**
 * Reference Discord moderation bot (discord.js v14), mirroring the Telegram bot:
 * same shared logic, same safe defaults (ignore bots, idempotency, self rate-limit,
 * human-gated bans). Requires the Message Content privileged intent.
 *
 * Install: npm i discord.js
 * Run:     DISCORD_TOKEN=... npx tsx bot.ts
 */
import { Client, GatewayIntentBits, Events, Message } from 'discord.js';
import { moderateMessage } from '../moderate-message';
import { classifyMessage, routeToPersona, RouteConfig } from '../classify-and-route';
import { InMemoryMemberStore, newMember } from '../member-store';
import { RateLimiter, IdempotencyStore } from '../rate-limiter';
import { checkImpersonation, ProtectedAdmin } from '../impersonation';

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error('Set DISCORD_TOKEN in the environment (never hardcode it).');

const OFFICIAL_DOMAINS = ['superteam.fun', 'earn.superteam.fun'];
const PROTECTED_ADMINS: ProtectedAdmin[] = [{ handle: 'kauenet', displayName: 'Kaue' }]; // from foka-config.json -> impersonation.protectedAdmins
const routeConfig: RouteConfig = {
  defaultPersona: 'triage',
  defaultChannel: '#support',
  routes: { 'payout-issue': { persona: 'ops', channel: '#ops' } },
};

const members = new InMemoryMemberStore();
const actions = new RateLimiter(20, 20);
const seen = new IdempotencyStore();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return; // self-guard
  if (!seen.firstSeen(message.id)) return; // idempotency

  // Block admin impersonators outright — they don't get to message.
  const imp = checkImpersonation(
    { handle: message.author.username, displayName: message.member?.displayName ?? message.author.username },
    PROTECTED_ADMINS,
  );
  if (imp.impersonator) {
    await message.delete().catch(() => {});
    await message.member?.timeout(24 * 60 * 60_000, `impersonating ${imp.matchedAdmin}`).catch(() => {});
    console.log('IMPERSONATION — muted', { user: message.author.username, matched: imp.matchedAdmin, reason: imp.reason });
    return;
  }

  const id = message.author.id;
  let rec = await members.get(id);
  if (!rec) {
    rec = newMember(id, message.author.username, 'discord');
    await members.upsert(rec);
  }
  const ageDays = Math.max(0, (Date.now() - message.author.createdTimestamp) / 86_400_000);

  const decision = moderateMessage({
    text: message.content,
    memberTrust: rec.trustState,
    accountAgeDays: ageDays,
    officialDomains: OFFICIAL_DOMAINS,
  });

  // TRUSTED members (mods, vouched) are never auto-actioned — a scam WARNING from a mod
  // contains scam keywords too. We still escalate for human review below.
  const enforce = rec.trustState !== 'TRUSTED';
  // Always remove flagged content (do NOT gate deletion on the self rate-limiter).
  if (enforce && (decision.action === 'delete' || decision.action === 'mute')) {
    await message.delete().catch(() => {});
    await members.recordWarning(id, { reason: decision.reasons.join(','), signal: decision.reasons[0] ?? 'n/a', actor: 'agent' });
  }
  // Throttle the heavier mute; escalate if the limiter trips. 1h timeout matches policy.
  if (enforce && decision.action === 'mute') {
    if (actions.allow()) {
      await message.member?.timeout(60 * 60_000, 'auto-mute 1h (appealable)').catch(() => {});
    } else {
      console.log('CIRCUIT-BREAKER: mute rate exceeded — escalating instead', { user: message.author.username });
    }
  }
  // ban/kick are irreversible — escalate to humans, never auto-execute.
  if (decision.escalate) {
    console.log('ESCALATE', { user: message.author.username, score: decision.score, reasons: decision.reasons });
  }

  if (decision.action === 'allow') {
    const c = classifyMessage(message.content);
    if (c.tag !== 'off-topic') {
      const r = routeToPersona(c, routeConfig, { handle: message.author.username, trustState: rec.trustState }, message.content.slice(0, 140));
      console.log(r.handoff);
    }
  }
});

client.login(token);
