/**
 * Reference Discord moderation bot (discord.js v14), mirroring the Telegram bot:
 * same shared logic, same safe defaults (ignore bots, idempotency, self rate-limit,
 * human-gated bans). Requires the Message Content privileged intent.
 *
 * Install: npm i discord.js
 * Run:     DISCORD_TOKEN=... npx tsx bot.ts
 */
import { Client, GatewayIntentBits, Events, Message, PermissionFlagsBits, ChannelType, TextChannel } from 'discord.js';
import { moderateMessage } from '../moderate-message';
import { classifyMessage, routeToPersona, RouteConfig } from '../classify-and-route';
import { InMemoryMemberStore, newMember } from '../member-store';
import { RateLimiter, IdempotencyStore } from '../rate-limiter';
import { checkImpersonation, ProtectedAdmin } from '../impersonation';
import { renderWelcome, WelcomeConfig } from '../welcome';
import { isImmune, explainImmunity, formatImmunityPolicy, ImmunityConfig } from '../immunity';
import { AuditLogger } from '../audit-log';
import { InMemoryEventLog } from '../event-log';
import { InMemoryTicketStore, TicketPanel, TicketCommandConfig } from '../ticketing';
import { registerTicketing, publishPanel, TICKET_SLASH_COMMANDS } from './ticketing';
import { buildReport, formatReport, renderHeatmap } from '../analytics';
import { buildDirectory, renderTable, type DirFilter } from '../member-directory';
import { renderHelp } from '../commands-help';

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error('Set DISCORD_TOKEN in the environment (never hardcode it).');

const OFFICIAL_DOMAINS = ['superteam.fun', 'earn.superteam.fun'];
const PROTECTED_ADMINS: ProtectedAdmin[] = [{ handle: 'kauenet', displayName: 'Kaue' }]; // from foka-config.json -> impersonation.protectedAdmins
const WELCOME: WelcomeConfig = {
  enabled: true,
  community: 'Superteam BR',
  rulesUrl: 'https://superteam.fun',
  message: 'Welcome to {community}, {name}! 👋 Please read the rules: {rules}\n🔒 Never share your seed phrase — admins will never DM you first.',
}; // from foka-config.json -> welcome
const routeConfig: RouteConfig = {
  defaultPersona: 'triage',
  defaultChannel: '#support',
  routes: { 'payout-issue': { persona: 'ops', channel: '#ops' } },
};
// from foka-config.json -> immunity. Holders are exempt from auto-mod + mod commands.
// Server owner, Administrator-permission roles, bot masters, and bots are immune by default.
const IMMUNITY: ImmunityConfig = {
  roles: ['Core Mods', 'Moderator', 'Superteam Earn', 'SuperTeam BR', 'Superteam XP', 'Zapier', 'MEE6', 'Tektools'],
  botMasters: [],
};

const TZ_OFFSET_MINUTES = -180; // from foka-config.json -> analytics.tzOffsetMinutes (BRT)
const members = new InMemoryMemberStore();
const events = new InMemoryEventLog(90); // group event log feeding analytics + the roster (no message content)
const actions = new RateLimiter(20, 20);
const seen = new IdempotencyStore();

function last7d() {
  const to = Date.now();
  return { from: new Date(to - 7 * 86_400_000).toISOString(), to: new Date(to).toISOString() };
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration, // for ban audit events
  ],
  // SECURITY: the bot echoes member-controlled text (welcome names, audit nicknames,
  // transcripts). A server-wide "parse nothing" default means no echoed @everyone/@here
  // or role mention can ping — mentions still render, they just don't notify. Any
  // intended ping would override this per-message.
  allowedMentions: { parse: [] },
});

// Audit logging (MEE6 parity): events → the log channel. Sink is injected so gating/formatting
// stays pure. Metadata only — never message content. Channel id from env (keep it out of config).
const AUDIT_CHANNEL = process.env.LOG_CHANNEL ?? '';
const audit = new AuditLogger(
  { enabled: !!AUDIT_CHANNEL, channel: AUDIT_CHANNEL, ignoredChannels: [], dontLogBots: true, dontDisplayThumbnails: false }, // from foka-config.json -> auditLog
  async (channel, text) => {
    const ch = client.channels.cache.get(channel) ?? (await client.channels.fetch(channel).catch(() => null)); // fetch if not cached
    if (ch?.isTextBased() && 'send' in ch) await (ch as { send: (t: string) => Promise<unknown> }).send(text).catch(() => {});
  },
);

// Wrap untrusted text (member names) in a code block safely: neutralize backticks so a
// crafted display name can't break out of the fence, and never parse mentions in the reply.
const fence = (s: string) => '```\n' + s.replace(/`/g, '`​') + '\n```';
const SAFE_REPLY = { allowedMentions: { parse: [] } };

// Ticketing (MEE6 parity): a panel button opens a private channel; managers run the
// /ticket-* commands; transcript on close. Config from foka-config.json -> ticketing.
const TICKET_PANEL: TicketPanel = {
  id: 'suporte',
  name: 'Superteam Suporte',
  publishChannel: 'atendimento',
  managerRoles: ['Moderator'],
  panelMessage: {
    title: 'Canal de Suporte',
    description: 'Este é o suporte da Superteam Brasil. Clique no botão para abrir seu ticket pessoal com o time de suporte.',
    color: '#5865F2',
  },
  types: [{ id: 'abrir', label: 'Abrir ticket', emoji: '🎫', color: 'red' }],
  introMessage: 'Seu ticket foi criado {opener} @Core Mods @Moderator.\nPor favor forneça as informações relevantes para que possamos te ajudar melhor.',
  openCategory: 'SUPORTE',
  closedCategory: 'SUPORTE',
  transcript: { channel: 'transcripts', dmToOpener: true },
  maxOpenPerUser: 1,
};
const TICKET_COMMAND_CONFIG: TicketCommandConfig = { claim: false, close: true, delete: true, reopen: true };
const tickets = new InMemoryTicketStore();
registerTicketing(client, { panel: TICKET_PANEL, store: tickets, commands: TICKET_COMMAND_CONFIG });

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return; // self-guard

  // Admin commands (Combot/MEE6 parity): !help / !stats / !members / !immunity / !ticket-setup. Manage-Server gated.
  if (/^!(help|stats|members|users|immunity|ticket-setup)\b/.test(message.content)) {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) return;
    if (message.content.startsWith('!help')) {
      await message.reply({ content: fence(renderHelp('!')), ...SAFE_REPLY }).catch(() => {});
    } else if (message.content.startsWith('!ticket-setup')) {
      await message.guild?.commands.set(TICKET_SLASH_COMMANDS).catch(() => {}); // register /ticket-* slash commands
      const ch = message.guild?.channels.cache.find(
        (c) => c.type === ChannelType.GuildText && c.name.toLowerCase() === TICKET_PANEL.publishChannel.replace(/^#/, '').toLowerCase(),
      ) as TextChannel | undefined;
      if (ch) { await publishPanel(ch, TICKET_PANEL); await message.reply(`🎫 Ticket panel published to <#${ch.id}> + /ticket-* commands registered.`).catch(() => {}); }
      else await message.reply(`⚠️ Channel #${TICKET_PANEL.publishChannel} not found.`).catch(() => {});
    } else if (message.content.startsWith('!stats')) {
      const report = buildReport(events.all(), last7d(), { tzOffsetMinutes: TZ_OFFSET_MINUTES });
      await message.reply({ content: fence(formatReport(report) + '\n\nActivity heatmap (BRT):\n' + renderHeatmap(report.heatmap)), ...SAFE_REPLY }).catch(() => {});
    } else if (message.content.startsWith('!immunity')) {
      const mention = message.mentions.members?.first();
      if (mention) {
        const verdict = explainImmunity(
          { id: mention.id, roles: mention.roles.cache.map((r) => r.name), isOwner: message.guild?.ownerId === mention.id, hasAdminPermission: mention.permissions.has(PermissionFlagsBits.Administrator), isBot: mention.user.bot },
          IMMUNITY,
        );
        await message.reply({ content: `${mention.user.username}: ${verdict}`, ...SAFE_REPLY }).catch(() => {});
      } else {
        const roleLines = (IMMUNITY.roles ?? []).map((name) => {
          const role = message.guild?.roles.cache.find((r) => r.name.toLowerCase() === name.replace(/^@+/, '').toLowerCase());
          return `  @${name.replace(/^@+/, '')}${role ? ` — ${role.members.size} member(s)` : ' — (role not found)'}`;
        });
        const body = formatImmunityPolicy(IMMUNITY) + '\n\nImmune roles in this server:\n' + (roleLines.join('\n') || '  —') + '\n\nServer owner + Administrator roles are also immune. Tip: !immunity @user to check.';
        await message.reply({ content: fence(body), ...SAFE_REPLY }).catch(() => {});
      }
    } else {
      const arg = message.content.split(/\s+/)[1]?.toLowerCase();
      const filter: DirFilter = arg === 'all' || arg === 'left' ? (arg as DirFilter) : 'current';
      const page = buildDirectory(await members.all(), events.all(), last7d(), { filter, sort: 'lastMsg', perPage: 20, tzOffsetMinutes: TZ_OFFSET_MINUTES });
      const footer = `\n\n${page.counts.current} current · ${page.counts.left} left · ${page.counts.all} total — ${filter} ${page.rows.length}/${page.total} (page ${page.page}/${page.pages})`;
      await message.reply({ content: fence(renderTable(page.rows) + footer), ...SAFE_REPLY }).catch(() => {});
    }
    return;
  }

  if (!seen.firstSeen(message.id)) return; // idempotency

  // Block admin impersonators outright — they don't get to message.
  const imp = checkImpersonation(
    { handle: message.author.username, displayName: message.member?.displayName ?? message.author.username },
    PROTECTED_ADMINS,
  );
  if (imp.impersonator) {
    await message.delete().catch(() => {});
    await message.member?.timeout(24 * 60 * 60_000, `impersonating ${imp.matchedAdmin}`).catch(() => {});
    await audit.log({ type: 'member_muted', at: new Date().toISOString(), target: { id: message.author.id, handle: message.author.username }, actor: { handle: 'agent' }, reason: `impersonating ${imp.matchedAdmin}` });
    console.log('IMPERSONATION — muted', { user: message.author.username, matched: imp.matchedAdmin, reason: imp.reason });
    return;
  }

  const id = message.author.id;
  const displayName = message.member?.displayName ?? message.author.username;
  let rec = await members.get(id);
  if (!rec) {
    rec = newMember(id, message.author.username, 'discord', displayName);
    await members.upsert(rec);
  }
  const ageDays = Math.max(0, (Date.now() - message.author.createdTimestamp) / 86_400_000);

  const decision = moderateMessage({
    text: message.content,
    memberTrust: rec.trustState,
    accountAgeDays: ageDays,
    officialDomains: OFFICIAL_DOMAINS,
  });

  // Immunity (MEE6 "Immunity Roles"): owner / admins / immune roles / bot masters are
  // exempt from auto-mod AND escalation. Immunity comes from config, never from chat.
  const immunity = isImmune(
    {
      id,
      roles: message.member?.roles.cache.map((r) => r.name),
      isOwner: message.guild?.ownerId === message.author.id,
      hasAdminPermission: message.member?.permissions.has(PermissionFlagsBits.Administrator),
      isBot: message.author.bot,
    },
    IMMUNITY,
  );
  if (immunity.immune && decision.action !== 'allow') {
    console.log('IMMUNE — skipping moderation', { user: message.author.username, reason: immunity.reason, matchedRole: immunity.matchedRole });
  }

  // TRUSTED members (mods, vouched) are never auto-actioned — a scam WARNING from a mod
  // contains scam keywords too. We still escalate for human review below.
  const enforce = !immunity.immune && rec.trustState !== 'TRUSTED';
  // Always remove flagged content (do NOT gate deletion on the self rate-limiter).
  if (enforce && (decision.action === 'delete' || decision.action === 'mute')) {
    await message.delete().catch(() => {});
    await members.recordWarning(id, { reason: decision.reasons.join(','), signal: decision.reasons[0] ?? 'n/a', actor: 'agent' });
    await audit.log({ type: 'message_deleted', at: new Date().toISOString(), target: { id, handle: message.author.username }, actor: { handle: 'agent' }, channelId: message.channelId, reason: decision.reasons[0] ?? 'auto-mod' });
  }
  // Throttle the heavier mute; escalate if the limiter trips. 1h timeout matches policy.
  if (enforce && decision.action === 'mute') {
    if (actions.allow()) {
      await message.member?.timeout(60 * 60_000, 'auto-mute 1h (appealable)').catch(() => {});
      await audit.log({ type: 'member_muted', at: new Date().toISOString(), target: { id, handle: message.author.username }, actor: { handle: 'agent' }, reason: 'auto-mute 1h' });
    } else {
      console.log('CIRCUIT-BREAKER: mute rate exceeded — escalating instead', { user: message.author.username });
    }
  }
  // ban/kick are irreversible — escalate to humans, never auto-execute. Immune users are exempt.
  if (!immunity.immune && decision.escalate) {
    console.log('ESCALATE', { user: message.author.username, score: decision.score, reasons: decision.reasons });
  }

  // Count kept messages for analytics + the roster (removed spam doesn't count).
  const kept = !enforce || (decision.action !== 'delete' && decision.action !== 'mute');
  if (kept) {
    const at = new Date().toISOString();
    events.record({ type: 'message', memberId: id, handle: message.author.username, displayName, at });
    await members.recordMessage(id, at);
  }

  if (decision.action === 'allow') {
    const c = classifyMessage(message.content);
    if (c.tag !== 'off-topic') {
      const r = routeToPersona(c, routeConfig, { handle: message.author.username, trustState: rec.trustState }, message.content.slice(0, 140));
      console.log(r.handoff);
    }
  }
});

// Welcome new members on join (requires the GuildMembers privileged intent) + record the join.
client.on(Events.GuildMemberAdd, async (member) => {
  const text = renderWelcome({ displayName: member.displayName, handle: member.user.username }, WELCOME);
  if (text && member.guild.systemChannel) await member.guild.systemChannel.send(text).catch(() => {});
  const mid = member.id;
  const existing = await members.get(mid);
  if (!existing) await members.upsert(newMember(mid, member.user.username, 'discord', member.displayName));
  else if (existing.leftAt) { existing.leftAt = undefined; await members.upsert(existing); } // rejoin
  const at = new Date().toISOString();
  events.record({ type: 'join', memberId: mid, handle: member.user.username, displayName: member.displayName, at });
  await audit.log({ type: 'member_joined', at, target: { id: mid, handle: member.user.username, isBot: member.user.bot, avatarUrl: member.displayAvatarURL() }, actor: { id: mid, handle: member.user.username, isBot: member.user.bot } });
});

// Record leaves (moves the member to the "Left" roster tab).
client.on(Events.GuildMemberRemove, async (member) => {
  const mid = member.id;
  const at = new Date().toISOString();
  await members.markLeft(mid, at);
  events.record({ type: 'leave', memberId: mid, handle: member.user?.username, at });
  await audit.log({ type: 'member_left', at, target: { id: mid, handle: member.user?.username, isBot: member.user?.bot } });
});

// Bans → audit (moderation + member ban events).
client.on(Events.GuildBanAdd, async (ban) => {
  const at = new Date().toISOString();
  await audit.log({ type: 'member_banned', at, target: { id: ban.user.id, handle: ban.user.username, isBot: ban.user.bot }, reason: ban.reason ?? undefined });
});

// Nickname + role changes → audit (member / role events).
client.on(Events.GuildMemberUpdate, async (oldM, newM) => {
  const at = new Date().toISOString();
  const target = { id: newM.id, handle: newM.user.username, isBot: newM.user.bot };
  if (oldM.nickname !== newM.nickname) {
    await audit.log({ type: 'nickname_changed', at, target, detail: `${oldM.nickname ?? '∅'} → ${newM.nickname ?? '∅'}` });
  }
  const added = newM.roles.cache.filter((r) => !oldM.roles.cache.has(r.id)).map((r) => '+' + r.name);
  const removed = oldM.roles.cache.filter((r) => !newM.roles.cache.has(r.id)).map((r) => '-' + r.name);
  if (added.length || removed.length) {
    await audit.log({ type: 'member_roles_changed', at, target, detail: [...added, ...removed].join(' ') });
  }
});

client.login(token);
