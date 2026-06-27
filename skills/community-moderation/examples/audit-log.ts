/**
 * Audit logging — MEE6 "Audit Logging" parity.
 *
 * Routes server events (moderation / message / member / role / voice / server /
 * channel) to a logging channel, gated by per-category toggles, ignored channels,
 * and "don't log bots". Pure + dependency-free; actually sending to the channel is
 * an INJECTED sink, so the gating/formatting is testable in isolation.
 *
 * PRIVACY: by default this logs event metadata (who/what/where/when) — NOT message
 * content. MEE6 mirrors deleted/edited text; we don't, to honor privacy.storeRawMessages.
 */

export type AuditCategory = 'moderation' | 'message' | 'member' | 'role' | 'voice' | 'server' | 'channel';

export type AuditEventType =
  // moderation
  | 'member_muted' | 'member_unmuted' | 'moderation_ban' | 'moderation_action'
  // message
  | 'message_updated' | 'message_deleted' | 'invite_posted'
  // member
  | 'nickname_changed' | 'member_banned' | 'member_joined' | 'member_left' | 'member_unbanned' | 'user_updated'
  // role
  | 'role_created' | 'role_updated' | 'role_deleted' | 'member_roles_changed'
  // voice
  | 'member_joined_voice' | 'member_left_voice'
  // server
  | 'server_edited' | 'emojis_updated'
  // channel
  | 'channel_created' | 'channel_updated' | 'channel_deleted';

export const EVENT_CATEGORY: Record<AuditEventType, AuditCategory> = {
  member_muted: 'moderation', member_unmuted: 'moderation', moderation_ban: 'moderation', moderation_action: 'moderation',
  message_updated: 'message', message_deleted: 'message', invite_posted: 'message',
  nickname_changed: 'member', member_banned: 'member', member_joined: 'member', member_left: 'member', member_unbanned: 'member', user_updated: 'member',
  role_created: 'role', role_updated: 'role', role_deleted: 'role', member_roles_changed: 'role',
  member_joined_voice: 'voice', member_left_voice: 'voice',
  server_edited: 'server', emojis_updated: 'server',
  channel_created: 'channel', channel_updated: 'channel', channel_deleted: 'channel',
};

const LABELS: Record<AuditEventType, string> = {
  member_muted: '🔇 Member muted', member_unmuted: '🔊 Member unmuted', moderation_ban: '🔨 Moderation ban', moderation_action: '🛡 Moderation action',
  message_updated: '✏️ Message edited', message_deleted: '🗑 Message deleted', invite_posted: '🔗 Invite posted',
  nickname_changed: '🏷 Nickname changed', member_banned: '🔨 Member banned', member_joined: '➕ Member joined', member_left: '➖ Member left', member_unbanned: '♻️ Member unbanned', user_updated: '👤 User updated',
  role_created: '✨ Role created', role_updated: '🔧 Role updated', role_deleted: '❌ Role deleted', member_roles_changed: '🎭 Member roles changed',
  member_joined_voice: '🔊 Joined voice', member_left_voice: '🔈 Left voice',
  server_edited: '🛠 Server edited', emojis_updated: '😀 Emojis updated',
  channel_created: '📂 Channel created', channel_updated: '🔧 Channel updated', channel_deleted: '🗑 Channel deleted',
};

export interface AuditActor {
  id?: string;
  handle?: string;
  isBot?: boolean;
  avatarUrl?: string;
}

export interface AuditEvent {
  type: AuditEventType;
  at: string; // ISO
  actor?: AuditActor; // who performed/triggered the event
  target?: AuditActor; // who/what it affected
  channelId?: string; // where (message/channel events; also checked against ignoredChannels)
  reason?: string;
  detail?: string; // freeform extra (old→new nick, role name, …) — never message content
}

// events[category][camelCaseEventKey] = boolean. Omitted → enabled (MEE6 default-on).
export type AuditEventToggles = Partial<Record<AuditCategory, Record<string, boolean>>>;

export interface AuditConfig {
  enabled: boolean;
  channel: string; // logging channel id (or @name); the sink decides how to deliver
  ignoredChannels?: string[]; // message events in these channels are skipped
  dontLogBots?: boolean; // skip events whose actor is a bot
  dontDisplayThumbnails?: boolean; // suppress avatar thumbnails in embeds
  events?: AuditEventToggles;
}

/** event_type → camelCase config key (member_muted → memberMuted). */
export function eventKey(type: AuditEventType): string {
  return type.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Should this event be logged given the config? (enabled → bot filter → ignored channel → category toggle) */
export function shouldLog(event: AuditEvent, config: AuditConfig): boolean {
  if (!config.enabled) return false;
  if (config.dontLogBots && event.actor?.isBot) return false;
  const category = EVENT_CATEGORY[event.type];
  if (category === 'message' && event.channelId && (config.ignoredChannels ?? []).includes(event.channelId)) {
    return false;
  }
  const toggles = config.events?.[category];
  return !(toggles && toggles[eventKey(event.type)] === false);
}

function nameOf(a?: AuditActor): string {
  if (!a) return '?';
  return a.handle ? '@' + a.handle.replace(/^@+/, '') : a.id ?? '?';
}

/** One-line audit entry for the logging channel (text mode; no message content). */
export function formatAuditEntry(event: AuditEvent): string {
  const label = LABELS[event.type] ?? event.type;
  const target = event.target ? ' ' + nameOf(event.target) : '';
  const detail = event.detail ? ` (${event.detail})` : '';
  const by = event.actor && (event.actor.handle || event.actor.id) ? ` by ${nameOf(event.actor)}` : '';
  const where = event.channelId ? ` in #${event.channelId}` : '';
  const reason = event.reason ? ` — ${event.reason}` : '';
  return `${label}:${target}${detail}${by}${where}${reason} · ${event.at}`.replace(/\s{2,}/g, ' ').trim();
}

/** The avatar to show on an embed, honoring dontDisplayThumbnails. */
export function auditThumbnail(event: AuditEvent, config: AuditConfig): string | undefined {
  if (config.dontDisplayThumbnails) return undefined;
  return event.target?.avatarUrl ?? event.actor?.avatarUrl;
}

export type AuditSink = (channel: string, text: string, event: AuditEvent) => void | Promise<void>;

/** Gates each event through the config, then dispatches the formatted line to the injected sink. */
export class AuditLogger {
  constructor(
    private config: AuditConfig,
    private sink: AuditSink,
  ) {}

  async log(event: AuditEvent): Promise<boolean> {
    if (!shouldLog(event, this.config)) return false;
    await this.sink(this.config.channel, formatAuditEntry(event), event);
    return true;
  }
}
