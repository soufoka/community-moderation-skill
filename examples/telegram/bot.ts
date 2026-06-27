/**
 * Reference Telegram moderation bot (grammY) with full wiring: member store,
 * self rate-limit, idempotency, human-gated bans. Wire the store to your DB.
 *
 * Install: npm i grammy
 * Run:     BOT_TOKEN=... npx tsx bot.ts
 */
import { Bot, Context } from 'grammy';
import { moderateMessage } from '../moderate-message';
import { classifyMessage, routeToPersona, RouteConfig } from '../classify-and-route';
import { InMemoryMemberStore, newMember } from '../member-store';
import { RateLimiter, IdempotencyStore } from '../rate-limiter';
import { checkImpersonation, ProtectedAdmin } from '../impersonation';
import { renderWelcome, WelcomeConfig } from '../welcome';
import { isImmune, explainImmunity, formatImmunityPolicy, ImmunityConfig } from '../immunity';
import { AuditLogger } from '../audit-log';
import { InMemoryEventLog } from '../event-log';
import { buildReport, formatReport, renderHeatmap } from '../analytics';
import { buildDirectory, renderTable, type DirFilter } from '../member-directory';
import { renderHelp } from '../commands-help';

const token = process.env.BOT_TOKEN;
if (!token) throw new Error('Set BOT_TOKEN in the environment (never hardcode it).');

const OFFICIAL_DOMAINS = ['superteam.fun', 'earn.superteam.fun'];
const PROTECTED_ADMINS: ProtectedAdmin[] = [{ handle: 'kauenet', displayName: 'Kaue' }]; // from foka-config.json -> impersonation.protectedAdmins
const WELCOME: WelcomeConfig = {
  enabled: true,
  community: 'Superteam BR',
  rulesUrl: 'https://superteam.fun',
  message: 'Welcome to {community}, {name}! 👋 Please read the pinned rules: {rules}\n🔒 Never share your seed phrase — admins will never DM you first.',
}; // from foka-config.json -> welcome
const routeConfig: RouteConfig = {
  defaultPersona: 'triage',
  defaultChannel: '#support',
  routes: { 'payout-issue': { persona: 'ops', channel: '#ops' } },
};
// from foka-config.json -> immunity. Holders are exempt from auto-mod + escalation.
// Telegram has no custom roles, so role matching uses an admin's custom_title; chat
// creator → owner, administrators → admin-permission. Immune by default + config-only.
const IMMUNITY: ImmunityConfig = {
  roles: ['Core Mods', 'Moderator', 'Superteam Earn', 'SuperTeam BR'],
  botMasters: [],
};

const TZ_OFFSET_MINUTES = -180; // from foka-config.json -> analytics.tzOffsetMinutes (BRT)
const members = new InMemoryMemberStore(); // swap for your DB-backed MemberStore
const events = new InMemoryEventLog(90); // group event log feeding analytics + the roster (no message content)
const actions = new RateLimiter(20, 20); // cap the agent's own actions/min
const seen = new IdempotencyStore();

const bot = new Bot(token);

// Audit logging (MEE6 parity): events → the log channel. Injected sink; metadata only,
// never message content. Channel id from env (keep it out of the committed config).
const AUDIT_CHANNEL = process.env.LOG_CHANNEL ?? '';
const audit = new AuditLogger(
  { enabled: !!AUDIT_CHANNEL, channel: AUDIT_CHANNEL, ignoredChannels: [], dontLogBots: true, dontDisplayThumbnails: false }, // from foka-config.json -> auditLog
  async (channel, text) => {
    if (channel) await bot.api.sendMessage(channel, text).catch(() => {});
  },
);

// ---- helpers: admin gate + a 7-day window + HTML escaping for <pre> blocks ----
async function isGroupAdmin(ctx: Context): Promise<boolean> {
  if (!ctx.from || !ctx.chat || ctx.chat.type === 'private') return false;
  try {
    const m = await ctx.getChatMember(ctx.from.id);
    return m.status === 'administrator' || m.status === 'creator';
  } catch {
    return false;
  }
}
function last7d() {
  const to = Date.now();
  return { from: new Date(to - 7 * 86_400_000).toISOString(), to: new Date(to).toISOString() };
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pre = (s: string) => '<pre>' + esc(s) + '</pre>';

// /help — list the admin commands (admin only).
bot.command('help', async (ctx) => {
  if (!(await isGroupAdmin(ctx))) return;
  await ctx.reply(pre(renderHelp('/')), { parse_mode: 'HTML' }).catch(() => {});
});

// /stats — group analytics dashboard (admin only). Combot "Analytics" parity.
bot.command('stats', async (ctx) => {
  if (!(await isGroupAdmin(ctx))) return;
  const report = buildReport(events.all(), last7d(), { tzOffsetMinutes: TZ_OFFSET_MINUTES });
  const body = formatReport(report) + '\n\nActivity heatmap (BRT):\n' + renderHeatmap(report.heatmap);
  await ctx.reply(pre(body), { parse_mode: 'HTML' }).catch(() => {});
});

// /members [current|all|left] — member roster (admin only). Combot "Users" parity, no XP.
bot.command(['members', 'users'], async (ctx) => {
  if (!(await isGroupAdmin(ctx))) return;
  const arg = (ctx.match || '').trim().toLowerCase();
  const filter: DirFilter = arg === 'all' || arg === 'left' ? (arg as DirFilter) : 'current';
  const page = buildDirectory(await members.all(), events.all(), last7d(), {
    filter,
    sort: 'lastMsg',
    page: 1,
    perPage: 20,
    tzOffsetMinutes: TZ_OFFSET_MINUTES,
  });
  const footer = `\n\n${page.counts.current} current · ${page.counts.left} left · ${page.counts.all} total — showing ${filter} ${page.rows.length}/${page.total} (page ${page.page}/${page.pages})`;
  await ctx.reply(pre(renderTable(page.rows) + footer), { parse_mode: 'HTML' }).catch(() => {});
});

// /immunity — show the policy + immune chat admins; reply to a message to check that user.
bot.command('immunity', async (ctx) => {
  if (!(await isGroupAdmin(ctx))) return;
  const target = ctx.msg.reply_to_message?.from;
  if (target) {
    const cm = await ctx.getChatMember(target.id).catch(() => null);
    const title = cm && 'custom_title' in cm ? (cm.custom_title as string | undefined) : undefined;
    const verdict = explainImmunity(
      { id: String(target.id), isOwner: cm?.status === 'creator', hasAdminPermission: cm?.status === 'administrator', isBot: target.is_bot, roles: title ? [title] : [] },
      IMMUNITY,
    );
    await ctx.reply(`@${target.username ?? target.id}: ${verdict}`).catch(() => {});
    return;
  }
  const admins = await ctx.getChatAdministrators().catch(() => []);
  const adminLines = admins
    .filter((a) => !a.user.is_bot)
    .map((a) => `  ${a.status === 'creator' ? '👑' : '🛡'} @${a.user.username ?? a.user.id}${'custom_title' in a && a.custom_title ? ' — ' + a.custom_title : ''}`);
  const body =
    formatImmunityPolicy(IMMUNITY) +
    `\n\nImmune chat admins (${adminLines.length}):\n` +
    (adminLines.join('\n') || '  —') +
    '\n\nTip: reply to a message with /immunity to check that user.';
  await ctx.reply(pre(body), { parse_mode: 'HTML' }).catch(() => {});
});

bot.on('message:text', async (ctx) => {
  if (ctx.from?.is_bot) return; // self-guard: never act on other bots
  // idempotency — Telegram message_id is unique per CHAT, not globally, so scope by chat.
  if (!seen.firstSeen(`${ctx.chat?.id ?? ''}:${ctx.msg.message_id}`)) return;

  // Block admin impersonators outright — they don't get to message.
  const imp = checkImpersonation(
    { handle: ctx.from?.username, displayName: [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') },
    PROTECTED_ADMINS,
  );
  if (imp.impersonator) {
    await ctx.deleteMessage().catch(() => {});
    await ctx.restrictChatMember(ctx.from!.id, { can_send_messages: false }).catch(() => {}); // can't send messages
    await audit.log({ type: 'member_muted', at: new Date().toISOString(), target: { id: String(ctx.from!.id), handle: ctx.from?.username }, actor: { handle: 'agent' }, reason: `impersonating ${imp.matchedAdmin}` });
    console.log('IMPERSONATION — muted', { user: ctx.from?.username, matched: imp.matchedAdmin, reason: imp.reason });
    return;
  }

  const id = String(ctx.from!.id);
  const displayName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || undefined;
  let rec = await members.get(id);
  if (!rec) {
    rec = newMember(id, ctx.from?.username ?? id, 'telegram', displayName);
    await members.upsert(rec);
  }
  const ageDays = (Date.now() - Date.parse(rec.joinedAt)) / 86_400_000;

  const decision = moderateMessage({
    text: ctx.msg.text,
    memberTrust: rec.trustState,
    accountAgeDays: ageDays,
    officialDomains: OFFICIAL_DOMAINS,
  });

  // Immunity (MEE6 "Immunity Roles"): chat creator / admins / immune custom-title /
  // bot masters are exempt from auto-mod AND escalation. Resolve admin status only when
  // an action would actually fire (avoids a getChatMember call on every message).
  let immune = false;
  let immuneReason: string | undefined;
  if (decision.action !== 'allow' || decision.escalate) {
    const cm = await ctx.getChatMember(ctx.from!.id).catch(() => null);
    const title = cm && 'custom_title' in cm ? (cm.custom_title as string | undefined) : undefined;
    const imm = isImmune(
      { id, isOwner: cm?.status === 'creator', hasAdminPermission: cm?.status === 'administrator', isBot: ctx.from?.is_bot, roles: title ? [title] : [] },
      IMMUNITY,
    );
    immune = imm.immune;
    immuneReason = imm.reason;
    if (immune) console.log('IMMUNE — skipping moderation', { user: ctx.from?.username, reason: immuneReason });
  }

  // TRUSTED members (mods, vouched) are never auto-actioned — a scam WARNING from a mod
  // contains scam keywords too. We still escalate for human review below.
  const enforce = !immune && rec.trustState !== 'TRUSTED';
  // Always remove flagged content (deletion is safe + reversible). Do NOT gate this on
  // the self rate-limiter, or a raid slips through once the bucket drains.
  if (enforce && (decision.action === 'delete' || decision.action === 'mute')) {
    await ctx.deleteMessage().catch(() => {});
    await members.recordWarning(id, { reason: decision.reasons.join(','), signal: decision.reasons[0] ?? 'n/a', actor: 'agent' });
    await audit.log({ type: 'message_deleted', at: new Date().toISOString(), target: { id, handle: ctx.from?.username }, actor: { handle: 'agent' }, channelId: String(ctx.chat?.id ?? ''), reason: decision.reasons[0] ?? 'auto-mod' });
  }
  // Mute is heavier — throttle it; if the limiter trips, escalate instead of mass-muting.
  if (enforce && decision.action === 'mute') {
    if (actions.allow()) {
      await ctx.restrictChatMember(ctx.from!.id, { can_send_messages: false }, { until_date: Math.floor(Date.now() / 1000) + 3600 }).catch(() => {});
      await audit.log({ type: 'member_muted', at: new Date().toISOString(), target: { id, handle: ctx.from?.username }, actor: { handle: 'agent' }, reason: 'auto-mute 1h' });
    } else {
      console.log('CIRCUIT-BREAKER: mute rate exceeded — escalating instead', { user: ctx.from?.username });
    }
  }
  // ban/kick are irreversible — escalate to humans, never auto-execute. Immune users are exempt.
  if (!immune && decision.escalate) {
    console.log('ESCALATE', { user: ctx.from?.username, score: decision.score, reasons: decision.reasons });
  }

  // Count kept messages for analytics + the roster (spam that was removed doesn't count).
  const kept = !enforce || (decision.action !== 'delete' && decision.action !== 'mute');
  if (kept) {
    const at = new Date().toISOString();
    events.record({ type: 'message', memberId: id, handle: ctx.from?.username, displayName, at });
    await members.recordMessage(id, at);
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

// Welcome new members on join + record the join event for analytics/roster.
bot.on('message:new_chat_members', async (ctx) => {
  for (const m of ctx.message.new_chat_members) {
    if (m.is_bot) continue;
    const displayName = [m.first_name, m.last_name].filter(Boolean).join(' ') || undefined;
    const text = renderWelcome({ displayName, handle: m.username }, WELCOME);
    if (text) await ctx.reply(text).catch(() => {});
    const mid = String(m.id);
    const existing = await members.get(mid);
    if (!existing) await members.upsert(newMember(mid, m.username ?? mid, 'telegram', displayName));
    else if (existing.leftAt) { existing.leftAt = undefined; await members.upsert(existing); } // rejoin
    const at = new Date().toISOString();
    events.record({ type: 'join', memberId: mid, handle: m.username, displayName, at });
    await audit.log({ type: 'member_joined', at, target: { id: mid, handle: m.username, isBot: m.is_bot }, actor: { id: mid, handle: m.username, isBot: m.is_bot } });
  }
});

// Record leaves (moves the member to the "Left" roster tab).
bot.on('message:left_chat_member', async (ctx) => {
  const m = ctx.message.left_chat_member;
  if (!m || m.is_bot) return;
  const mid = String(m.id);
  const at = new Date().toISOString();
  await members.markLeft(mid, at);
  events.record({ type: 'leave', memberId: mid, handle: m.username, at });
  await audit.log({ type: 'member_left', at, target: { id: mid, handle: m.username } });
});

bot.start();
