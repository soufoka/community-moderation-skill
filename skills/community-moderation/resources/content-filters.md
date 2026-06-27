# Content-type filters (Combot "Filters" parity)

Deterministic, per-content-type filters — the same catalog a Telegram group runs in **Combot → Moderation → Filters**. These are separate from the heuristic scam scorer: a filter acts on *what kind of content a message is* (a sticker, a link, a forward), not on how scammy its text reads.

- **Config:** `templates/foka-config.json` → `contentFilters` (one entry per filter below).
- **Logic:** [`examples/content-filters.ts`](../examples/content-filters.ts) — `detectTelegramFeatures()` → `applyContentFilters()`.
- **Layering:** run filters **before** the scorer ([`examples/moderate-message.ts`](../examples/moderate-message.ts)). A filtered content type is removed regardless of scam score; the scorer judges what survives.

## Actions

Each filter's value is the action applied when a message carries that content type:

`allow` (pass) · `warn` · `delete` · `mute` · `kick` · `ban` — plus `off` (= disabled = allow) for the toggle filters.

When several filters match one message, the **strictest** action wins (`allow < warn < delete < mute < kick < ban`).

**Trust override:** for `NEW`/`FLAGGED` members, `trust.newMemberNoLinks` blocks links and `trust.newMemberNoMedia` blocks media **even when the base filter says `allow`** — so you can keep media open for the community but gated for brand-new accounts.

## The catalog

Order matches the Combot panel top-to-bottom. "Default" is the shipped template value (mirrors a typical safe Superteam BR setup: words + links removed, everything else open).

| Filter (config key) | What it catches | Telegram signal | Default |
|---|---|---|---|
| `wordsFilter` | A banned word/phrase matched | `moderation.bannedSubstrings` hit (normalized) | `delete` |
| `links` | Any non-whitelisted link/domain | `url`/`text_link` entity or bare URL | `delete` |
| `rtlCharacters` | Right-to-left / bidi control chars used to disguise text | bidi control codepoints | `allow` |
| `commands` | `/slash` bot commands | `bot_command` entity | `allow` |
| `games` | Telegram games | `game` | `allow` |
| `voiceMessages` | Voice notes | `voice` | `allow` |
| `files` | Documents / files | `document` | `allow` |
| `videoMessages` | Round video notes | `video_note` | `allow` |
| `audioFiles` | Music / audio | `audio` | `allow` |
| `messagesFromChannels` | Posts sent on behalf of a linked channel | `sender_chat.type = channel` | `allow` |
| `animatedDice` | 🎲 🎯 🎰 dice/darts/slots | `dice` | `allow` |
| `mentions` | `@username` mentions (any) | `mention`/`text_mention` entity | `allow` |
| `viaInlineBots` | Messages sent via an inline bot | `via_bot` | `allow` |
| `stickers` | Stickers | `sticker` | `allow` |
| `gifs` | Animated GIFs | `animation` | `allow` |
| `externalQuotes` | Quoted replies pulled from another chat | `quote` | `allow` |
| `stories` | Shared stories | `story` | `allow` |
| `images` | Photos | `photo` | `allow` |
| `customEmojis` | Premium custom emoji | `custom_emoji` entity | `allow` |
| `editedMessages` | Edited messages | `edit_date` | `allow` |
| `videos` | Videos | `video` | `allow` |
| `serviceMessages` | Join/leave/pin/title-change events | `new_chat_members`, `pinned_message`, … | `allow` |
| `contacts` | Shared phone contacts | `contact` | `allow` |
| `forwards` | Forwarded messages | `forward_origin`/`forward_date` | `allow` |
| `duplicateTextMessages` | Near-identical repeats (Combot **Pro**) | `contentHash` repeat count | `allow` |
| `guestMode` | Unverified "guest" members (member-state policy, not a message type) | trust state | `allow` |
| `messageLength` | Over a max character length (Combot **Pro**) | `text.length > max` | `off` |

## Notes & gotchas

- **`mentions` vs mass-mentions.** This filter removes *any* `@mention` when set above `allow`. It's distinct from the scorer's mass-mention signal (≥5 mentions), which always scores spam regardless of this filter. Leave at `allow` unless you want a strict no-tagging room.
- **`wordsFilter` and `links`** only set the *action*; the data lives elsewhere — words in `moderation.bannedSubstrings`, domains in `community.officialDomains` (whitelist) / `community.blocklistDomains`. Whitelisted links are never filtered, even for new members.
- **`guestMode`** is a member-state policy, not a per-message content type. Keep it in the catalog for parity, but enforce it through the trust state machine ([`resources/moderation-policy.md`](moderation-policy.md)); `detectTelegramFeatures()` does not emit it.
- **`messageLength`** is parameterized: `{ "action": "delete", "max": 1200 }`. With `"off"` (or `max: 0`) it never fires.
- **Least force.** Defaults stay at `delete`/`warn`, never `ban` — content-type alone is rarely ban-worthy. Escalate via the ladder in [`resources/moderation-policy.md`](moderation-policy.md), and remember bans are human-gated.

## Wiring (illustrative)

```ts
import { detectTelegramFeatures, applyContentFilters, maxLengthFromConfig } from './content-filters';
import { moderateMessage } from './moderate-message';

const cf = config.contentFilters;
const features = detectTelegramFeatures(ctx.msg, {
  maxLength: maxLengthFromConfig(cf),
  duplicate: repeatedCount >= 1,
});

const filtered = applyContentFilters(features, cf, {
  memberTrust,
  newMemberNoLinks: config.trust.newMemberNoLinks,
  newMemberNoMedia: config.trust.newMemberNoMedia,
});

if (filtered.action !== 'allow') {
  // apply filtered.action (delete/mute/…) and log filtered.reasons, then stop.
} else {
  const decision = moderateMessage({ text: ctx.msg.text ?? '', memberTrust, accountAgeDays });
  // …handle scorer decision
}
```
