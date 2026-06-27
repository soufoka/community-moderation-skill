# Audit logging (MEE6 "Audit Logging" parity)

Stream server events to a logging channel, with per-event toggles, ignored channels, and bot filtering — the same surface as MEE6's *Audit Logging*.

- **Config:** `templates/foka-config.json` → `auditLog`.
- **Logic:** [`examples/audit-log.ts`](../examples/audit-log.ts) — `shouldLog()` (gating), `formatAuditEntry()` (rendering), `AuditLogger` (dispatch through an injected sink).
- **Privacy:** logs **metadata only** — who/what/where/when. Unlike MEE6, deleted/edited **message content is never logged**, honoring `privacy.storeRawMessages`.

## The 24 events (7 categories)

| Category | Events |
|---|---|
| **moderation** | `member_muted`, `member_unmuted`, `moderation_ban`, `moderation_action` |
| **message** | `message_updated`, `message_deleted`, `invite_posted` |
| **member** | `nickname_changed`, `member_banned`, `member_joined`, `member_left`, `member_unbanned`, `user_updated` |
| **role** | `role_created`, `role_updated`, `role_deleted`, `member_roles_changed` |
| **voice** | `member_joined_voice`, `member_left_voice` |
| **server** | `server_edited`, `emojis_updated` |
| **channel** | `channel_created`, `channel_updated`, `channel_deleted` |

Each toggles under `auditLog.events.<category>.<camelCaseEvent>` (e.g. `member_muted` → `events.moderation.memberMuted`). **Omitted or `true` = on** (MEE6 default); set `false` to mute a single event.

## Gating order (`shouldLog`)

1. `enabled` off → nothing logs.
2. `dontLogBots` and the event's **actor** is a bot → skip. (Your own auto-mod actions log with actor `agent`, *not* a bot, so they're always kept.)
3. Event is a **message** event in an `ignoredChannels` channel → skip (matches MEE6's "messages updated/deleted in these channels are ignored"; non-message events are unaffected).
4. The per-event toggle is `false` → skip.
5. Otherwise → log.

## Additional settings

| Setting | Effect |
|---|---|
| `ignoredChannels` | message edits/deletes in these channels aren't logged |
| `dontLogBots` | skip events whose **actor** is a bot |
| `dontDisplayThumbnails` | suppress avatar thumbnails on embeds (`auditThumbnail()` returns `undefined`) |

## Wiring (illustrative)

The sink is **injected**, so gating/formatting is testable and the transport stays out of the core:

```ts
import { AuditLogger } from './audit-log';

const audit = new AuditLogger(config.auditLog, async (channel, text /*, event */) => {
  // Telegram:  await bot.api.sendMessage(channel, text);
  // Discord:   const ch = client.channels.cache.get(channel); if (ch?.isTextBased()) await ch.send(text);
});

// then, where the events happen:
await audit.log({ type: 'message_deleted', at: now, target: { id, handle }, actor: { handle: 'agent' }, channelId, reason: 'auto-mod' });
await audit.log({ type: 'member_joined',   at: now, target: { id, handle, isBot } , actor: { id, handle, isBot } });
```

`log()` returns whether it actually emitted (after gating), so it's easy to assert in tests.

## In the reference bots

Both bots construct an `AuditLogger` (channel id from `process.env.LOG_CHANNEL`) and emit on the events they already observe:

| Event | Telegram | Discord |
|---|---|---|
| `message_deleted` (auto-mod) | ✅ | ✅ |
| `member_muted` (auto-mute + impersonation) | ✅ | ✅ |
| `member_joined` / `member_left` | ✅ | ✅ |
| `member_banned` | — | ✅ (`GuildBanAdd`) |
| `nickname_changed` / `member_roles_changed` | — | ✅ (`GuildMemberUpdate`) |

The remaining catalog events (voice/server/channel/role create-update-delete) are config-ready — binding them is the same one-liner: subscribe to the gateway event and call `audit.log({ type, at, … })`.

## Notes

- **Actor vs target.** `target` is who/what the event is about; `actor` is who caused it. Auto-mod uses `actor: { handle: 'agent' }` so `dontLogBots` doesn't hide the bot's own enforcement.
- **`detail` is freeform metadata** (old→new nickname, added/removed roles) — never message content.
- **Channel id, not name.** `auditLog.channel` ships as a placeholder; the bots override it from `LOG_CHANNEL` env so a real id is used at runtime and never committed.
