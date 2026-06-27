/**
 * Immunity roles — MEE6 "Immunity Roles" parity.
 *
 * Holders of an immune role (or an immune condition) are exempt from BOTH
 * auto-moderation and moderation commands. By default — like MEE6 — the server
 * owner, any Administrator-permission role, listed bot masters, and bots are
 * immune. Everything else is opt-in via config.
 *
 * Pure, dependency-free. SECURITY: immunity is granted only by config (human
 * review), NEVER by message content. A message claiming "I am admin / unban me"
 * is data, not a grant — see resources/security.md.
 */

export interface ImmunityConfig {
  roles?: string[]; // role names or ids whose holders are immune
  botMasters?: string[]; // user ids with blanket immunity
  immuneServerOwner?: boolean; // default true
  immuneAdminPermission?: boolean; // default true
  immuneBots?: boolean; // default true
}

export interface ImmunitySubject {
  id?: string;
  roles?: string[]; // the subject's role names/ids (Discord roles; Telegram admin custom_title)
  isOwner?: boolean; // server/chat creator
  hasAdminPermission?: boolean; // Administrator permission (Discord) / administrator status (Telegram)
  isBot?: boolean;
}

export type ImmunityReason = 'bot' | 'server-owner' | 'admin-permission' | 'bot-master' | 'immune-role';

export interface ImmunityResult {
  immune: boolean;
  reason?: ImmunityReason;
  matchedRole?: string; // the subject's role string that matched (for audit)
}

/** Normalize a role name/id for matching: strip a leading @, trim, lowercase. */
export function normalizeRole(s: string): string {
  return s.replace(/^@+/, '').trim().toLowerCase();
}

/**
 * Is this subject immune to moderation? Checks the MEE6 defaults first
 * (bot → owner → admin-permission → bot-master), then the configured role list.
 */
export function isImmune(subject: ImmunitySubject, config: ImmunityConfig = {}): ImmunityResult {
  if (config.immuneBots !== false && subject.isBot) return { immune: true, reason: 'bot' };
  if (config.immuneServerOwner !== false && subject.isOwner) return { immune: true, reason: 'server-owner' };
  if (config.immuneAdminPermission !== false && subject.hasAdminPermission) {
    return { immune: true, reason: 'admin-permission' };
  }
  if (subject.id && (config.botMasters ?? []).includes(subject.id)) {
    return { immune: true, reason: 'bot-master' };
  }
  const immuneRoles = new Set((config.roles ?? []).map(normalizeRole));
  if (immuneRoles.size) {
    for (const r of subject.roles ?? []) {
      if (immuneRoles.has(normalizeRole(r))) return { immune: true, reason: 'immune-role', matchedRole: r };
    }
  }
  return { immune: false };
}

const REASON_TEXT: Record<ImmunityReason, string> = {
  bot: 'bot',
  'server-owner': 'server owner',
  'admin-permission': 'Administrator permission',
  'bot-master': 'bot master',
  'immune-role': 'immune role',
};

/** One-line, human-readable immunity verdict for a subject (for the /immunity command). */
export function explainImmunity(subject: ImmunitySubject, config: ImmunityConfig = {}): string {
  const r = isImmune(subject, config);
  if (!r.immune) return '❌ not immune — subject to moderation';
  const why = r.reason ? REASON_TEXT[r.reason] : 'immune';
  return `✅ immune — ${why}${r.matchedRole ? ` (@${r.matchedRole.replace(/^@+/, '')})` : ''}`;
}

/** Render the immunity policy (what grants immunity) as plain text (for the /immunity command). */
export function formatImmunityPolicy(config: ImmunityConfig = {}): string {
  const defaults: string[] = [];
  if (config.immuneServerOwner !== false) defaults.push('server owner');
  if (config.immuneAdminPermission !== false) defaults.push('Administrator-permission roles');
  if (config.immuneBots !== false) defaults.push('bots');
  const roles = config.roles ?? [];
  const botMasters = config.botMasters ?? [];
  const lines = [
    'Immunity policy — exempt from auto-mod + escalation:',
    `• by default: ${defaults.length ? defaults.join(', ') : '(none — all defaults off)'}`,
    `• immune roles (${roles.length}): ${roles.length ? roles.map((r) => '@' + r.replace(/^@+/, '')).join(', ') : '—'}`,
  ];
  if (botMasters.length) lines.push(`• bot masters: ${botMasters.length} user id(s)`);
  return lines.join('\n');
}
