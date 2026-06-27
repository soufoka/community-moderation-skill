/**
 * Deterministic content-type filters — Combot "Filters" parity.
 *
 * Telegram/Discord messages carry zero or more content *features* (sticker, gif,
 * link, forward, edited, …). This module maps the features present on a message
 * to the action configured in foka-config.json → contentFilters, and returns the
 * STRICTEST one. Pure, dependency-free.
 *
 * Layering: run this BEFORE the scam scorer (moderate-message.ts). A filtered
 * content type (e.g. "no GIFs") is removed regardless of scam score; the scorer
 * then handles what survives. NEW/FLAGGED members are additionally restricted by
 * the trust.newMember* flags even when the base filter says "allow".
 */

export type FilterAction = 'allow' | 'warn' | 'delete' | 'mute' | 'kick' | 'ban';
export type TrustState = 'NEW' | 'MEMBER' | 'TRUSTED' | 'FLAGGED' | 'MUTED' | 'BANNED';

// Every filter Combot exposes under "Filters", platform-agnostic. Order mirrors
// the Combot panel top-to-bottom so the config reads like the UI.
export const CONTENT_FILTERS = [
  'wordsFilter',           // banned words (action for a moderation.bannedSubstrings hit)
  'links',                 // any non-whitelisted link/domain
  'rtlCharacters',         // right-to-left / bidi control characters
  'commands',              // /slash bot commands
  'games',                 // Telegram games
  'voiceMessages',         // voice notes
  'files',                 // documents / files
  'videoMessages',         // round video notes
  'audioFiles',            // music / audio
  'messagesFromChannels',  // posts sent on behalf of a linked channel
  'animatedDice',          // 🎲 🎯 🎰 dice/darts/slots
  'mentions',              // @username mentions
  'viaInlineBots',         // messages sent via an inline bot
  'stickers',              // stickers
  'gifs',                  // animated GIFs
  'externalQuotes',        // quoted replies pulled from another chat
  'stories',               // shared stories
  'images',                // photos
  'customEmojis',          // premium custom emoji
  'editedMessages',        // edited messages
  'videos',                // videos
  'serviceMessages',       // join/leave/pin/title-change service events
  'contacts',              // shared phone contacts
  'forwards',              // forwarded messages
  'duplicateTextMessages', // near-identical repeats (Combot Pro)
  'guestMode',             // unverified "guest" members (member-state policy)
  'messageLength',         // over a max character length (Combot Pro)
] as const;

export type ContentFilter = (typeof CONTENT_FILTERS)[number];

/** A filter is either an action, the literal "off" (= disabled = allow), or an object (for parameterized filters like messageLength). */
export type FilterRule = FilterAction | 'off' | { action: FilterAction | 'off'; max?: number };
export type ContentFilterConfig = Partial<Record<ContentFilter, FilterRule>>;

export interface ContentFilterContext {
  memberTrust?: TrustState;
  newMemberNoLinks?: boolean; // from trust.newMemberNoLinks
  newMemberNoMedia?: boolean; // from trust.newMemberNoMedia
}

export interface FilterDecision {
  action: FilterAction; // strictest action across all matched filters ('allow' = pass)
  matched: { filter: ContentFilter; action: FilterAction }[];
  reasons: string[]; // e.g. ['filter:links', 'filter:stickers']
}

// Escalation order — "strictest wins" when several filters fire on one message.
const RANK: Record<FilterAction, number> = { allow: 0, warn: 1, delete: 2, mute: 3, kick: 4, ban: 5 };

// Content types covered by trust.newMemberNoMedia.
const MEDIA: ReadonlySet<ContentFilter> = new Set<ContentFilter>([
  'files', 'images', 'videos', 'videoMessages', 'voiceMessages',
  'audioFiles', 'gifs', 'stickers', 'animatedDice', 'customEmojis', 'stories',
]);

/** Resolve a config rule to a concrete action. "off"/missing → "allow". */
export function ruleAction(rule: FilterRule | undefined): FilterAction {
  if (rule == null) return 'allow';
  const a = typeof rule === 'string' ? rule : rule.action;
  return a === 'off' ? 'allow' : a;
}

/**
 * Decide the action for a message given the content features it carries.
 * `present` is the list of features detected on the message (see detectTelegramFeatures).
 */
export function applyContentFilters(
  present: ContentFilter[],
  config: ContentFilterConfig = {},
  ctx: ContentFilterContext = {},
): FilterDecision {
  const untrusted = ctx.memberTrust === 'NEW' || ctx.memberTrust === 'FLAGGED';
  const matched: { filter: ContentFilter; action: FilterAction }[] = [];
  const reasons: string[] = [];

  for (const f of present) {
    let action = ruleAction(config[f]);
    // Trust override: NEW/FLAGGED members are stricter than the base filter. Upgrade any
    // action weaker than 'delete' (allow OR warn) so "new members can't post links/media"
    // actually removes them — a stricter base action (mute/kick/ban) is left untouched.
    if (untrusted && RANK[action] < RANK.delete) {
      if (f === 'links' && ctx.newMemberNoLinks) action = 'delete';
      else if (MEDIA.has(f) && ctx.newMemberNoMedia) action = 'delete';
    }
    if (action !== 'allow') {
      matched.push({ filter: f, action });
      reasons.push('filter:' + f);
    }
  }

  const action = matched.reduce<FilterAction>(
    (acc, m) => (RANK[m.action] > RANK[acc] ? m.action : acc),
    'allow',
  );
  return { action, matched, reasons };
}

/** The character-length cap from a messageLength rule (0/undefined = no cap). */
export function maxLengthFromConfig(config: ContentFilterConfig = {}): number {
  const rule = config.messageLength;
  if (rule && typeof rule === 'object' && rule.action !== 'off') return rule.max ?? 0;
  return 0;
}

// Structural shape of a Telegram message — only the fields we read. Kept local so
// this module stays dependency-free (no grammY import).
interface TgEntity { type: string }
interface TgMessage {
  text?: string;
  caption?: string;
  entities?: TgEntity[];
  caption_entities?: TgEntity[];
  sticker?: unknown;
  animation?: unknown;
  photo?: unknown;
  video?: unknown;
  video_note?: unknown;
  voice?: unknown;
  audio?: unknown;
  document?: unknown;
  dice?: unknown;
  contact?: unknown;
  story?: unknown;
  game?: unknown;
  via_bot?: unknown;
  quote?: unknown;
  edit_date?: number;
  forward_origin?: unknown;
  forward_date?: number;
  sender_chat?: { type?: string };
  new_chat_members?: unknown;
  left_chat_member?: unknown;
  pinned_message?: unknown;
  new_chat_title?: unknown;
  new_chat_photo?: unknown;
  group_chat_created?: unknown;
}

/**
 * Map a Telegram (Bot API / grammY) message to the content features present.
 * Illustrative — bind your transport's message shape here. `wordsFilter` and
 * `duplicateTextMessages` are computed elsewhere (scorer / contentHash) and passed in.
 */
export function detectTelegramFeatures(
  msg: TgMessage,
  opts: { maxLength?: number; duplicate?: boolean; wordsHit?: boolean } = {},
): ContentFilter[] {
  const f = new Set<ContentFilter>();
  const text = msg.text ?? msg.caption ?? '';
  const entities = [...(msg.entities ?? []), ...(msg.caption_entities ?? [])];
  const hasEntity = (...types: string[]) => entities.some((e) => types.includes(e.type));

  if (hasEntity('url', 'text_link') || /\bhttps?:\/\//i.test(text)) f.add('links');
  if (hasEntity('bot_command') || /^\//.test(text)) f.add('commands');
  if (hasEntity('mention', 'text_mention')) f.add('mentions');
  if (hasEntity('custom_emoji')) f.add('customEmojis');
  // Bidi / RTL control characters used to disguise text.
  if (/[‎‏‪-‮⁦-⁩]/.test(text)) f.add('rtlCharacters');

  if (msg.sticker) f.add('stickers');
  if (msg.animation) f.add('gifs');
  if (msg.photo) f.add('images');
  if (msg.video) f.add('videos');
  if (msg.video_note) f.add('videoMessages');
  if (msg.voice) f.add('voiceMessages');
  if (msg.audio) f.add('audioFiles');
  if (msg.document) f.add('files');
  if (msg.dice) f.add('animatedDice');
  if (msg.contact) f.add('contacts');
  if (msg.story) f.add('stories');
  if (msg.game) f.add('games');

  if (msg.via_bot) f.add('viaInlineBots');
  if (msg.quote) f.add('externalQuotes');
  if (msg.edit_date) f.add('editedMessages');
  if (msg.forward_origin || msg.forward_date) f.add('forwards');
  if (msg.sender_chat?.type === 'channel') f.add('messagesFromChannels');
  if (
    msg.new_chat_members || msg.left_chat_member || msg.pinned_message ||
    msg.new_chat_title || msg.new_chat_photo || msg.group_chat_created
  ) f.add('serviceMessages');

  if (opts.wordsHit) f.add('wordsFilter');
  if (opts.duplicate) f.add('duplicateTextMessages');
  if (opts.maxLength && text.length > opts.maxLength) f.add('messageLength');

  return [...f];
}
