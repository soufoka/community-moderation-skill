/**
 * Admin command help — single source of truth for both reference bots.
 * Pure & dependency-free; the prefix differs per platform ('/' Telegram, '!' Discord).
 */

export interface CommandHelp {
  name: string;
  args?: string;
  desc: string;
}

export const ADMIN_COMMANDS: CommandHelp[] = [
  { name: 'stats', desc: 'Group analytics: joins/leaves, messages, active users, DAU + activity heatmap (last 7 days)' },
  { name: 'members', args: '[current|all|left]', desc: 'Member roster — ID, Name, MSG, active days, warns, last msg, trust (no XP)' },
  { name: 'immunity', args: '[@user]', desc: "Immunity policy + who's exempt; with a user, check if they're immune and why" },
  { name: 'help', desc: 'Show this list' },
];

/** Render the admin command list for a platform prefix. */
export function renderHelp(prefix: string, commands: CommandHelp[] = ADMIN_COMMANDS): string {
  const sig = (c: CommandHelp) => prefix + c.name + (c.args ? ' ' + c.args : '');
  const width = Math.max(...commands.map((c) => sig(c).length));
  const lines = ['Foka AI — admin commands:'];
  for (const c of commands) lines.push(`  ${sig(c).padEnd(width)}  ${c.desc}`);
  lines.push(
    '',
    'Admin-only. ' +
      (prefix === '/'
        ? 'Reply to a message with /immunity to check that user.'
        : 'Use !immunity @user to check a member.'),
  );
  return lines.join('\n');
}
