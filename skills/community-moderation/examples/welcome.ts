/**
 * Configurable welcome message for new members. Pure renderer (testable); the bots call
 * renderWelcome() on a join event and post the result. The new member's name is sanitized
 * (URLs/invite links stripped, length-capped) so a scammer can't get a link echoed by the bot.
 */
export interface WelcomeConfig {
  enabled: boolean;
  message: string; // supports {name}, {community}, {rules}
  community?: string;
  rulesUrl?: string;
}

function safeName(member: { displayName?: string; handle?: string }): string {
  const raw = member.displayName || (member.handle ? '@' + member.handle.replace(/^@/, '') : '');
  const cleaned = raw
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\b(?:t\.me|discord\.gg|www\.)\/\S+/gi, '')
    // Break mention triggers so an echoed name can't ping anyone: @everyone / @here on
    // Discord, @username on Telegram. A zero-width space after @/# keeps the text readable
    // but stops the platform from forming a real mention.
    .replace(/([@#＠])/g, '$1​')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  return cleaned || 'there';
}

/** Render the welcome text, or undefined if disabled / no message configured. */
export function renderWelcome(
  member: { displayName?: string; handle?: string },
  cfg: WelcomeConfig,
): string | undefined {
  if (!cfg.enabled || !cfg.message.trim()) return undefined;
  return cfg.message
    .replace(/\{name\}/g, safeName(member))
    .replace(/\{community\}/g, cfg.community ?? 'the community')
    .replace(/\{rules\}/g, cfg.rulesUrl ?? '');
}
