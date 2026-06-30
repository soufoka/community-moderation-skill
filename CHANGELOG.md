# Changelog

All notable changes to this skill are documented here.

## [1.3.0] — 2026-06-27

### Added
- **WhatsApp support intake — compliant 1:1 channel, NOT group moderation.** WhatsApp has no API, official or otherwise, to read or moderate a group chat — so this adds a member-initiated DM channel on the official WhatsApp Business Cloud API instead, reusing the existing core rather than forking it:
  - `examples/whatsapp-intake.ts` (pure, tested): parses the Cloud API webhook payload (`parseCloudApiWebhook`, ignoring non-text/status events without throwing), decides scam-check vs. support-ticket intent (`looksLikeScamCheck`), renders the advisory scam-check reply and the ticket-ack reply, and verifies the webhook's `X-Hub-Signature-256` HMAC (constant-time compare).
  - `examples/whatsapp/bot.ts`: a dependency-free Node `http` webhook server (handshake + signature-gated receive) that calls the **same** `moderateMessage`/`scanUrls` (advisory scam-check, no action taken — there's no group to act in) or the **same** `ticketing.ts`/`classify-and-route.ts`/`member-store.ts`/`event-log.ts` core the Discord/Telegram bots use (support path), with the WhatsApp conversation's `wa_id` standing in for a "channel."
  - `MemberRecord.platform` widened to include `'whatsapp'`; a WhatsApp contact shares the same roster/analytics as Telegram/Discord members (joins/leaves stay 0 for this platform — there's no group to join).
  - Config in `templates/foka-config.json` → `whatsapp` (non-secret only; token/verify-token/app-secret are env-only). Full compliant-scope writeup, setup steps, and security notes: `resources/whatsapp-intake.md`.
  - `engines.node` bumped to `>=18` (the adapter uses global `fetch` to call the Graph API). 16 new tests; smoke +6 checks.

## [1.2.0] — 2026-06-27

### Added
- **3 new MCP tools** expose the community-ops layer so Claude/Cursor (or any MCP client) can call it directly: `apply_content_filters` (content-type filter decision), `check_immunity` (MEE6 immunity check), and `build_analytics` (group analytics + day×hour heatmap from an event log). `moderate_message` also gained the `massPingTokens` arg. The MCP server now exposes **6 tools** (was 3).
- **README** Features entry covering the Combot/MEE6-parity community ops + the channel-wide ping guard.

### Changed
- **Quickstart** rewritten for the plugin layout — correct paths, the new config blocks (`contentFilters`/`immunity`/`auditLog`/`analytics`/`ticketing`/`massPingTokens`), and an admin command table (`/stats`, `/members`, `/immunity`, `/help`, `!ticket-setup`).

## [1.1.1] — 2026-06-27

### Changed
- **Channel-wide ping tokens are now configurable.** `foka-config.json` → `moderation.massPingTokens` (passed to the scorer as `input.massPingTokens`) lets a community add/remove the `@`-tokens that trip the `mass-ping` signal, with the built-in list as the default. Tokens are matched as **escaped literals** joined into one alternation — never user-supplied regex, so it stays ReDoS-safe — and an empty list disables the check. Wired into both reference bots (`MASS_PING_TOKENS`). 3 tests added (custom list, disable, metacharacter escaping).

## [1.1.0] — 2026-06-27

### Added
- **Channel-wide ping protection (`@everyone` / `@here` / `@all`).** A non-admin who posts `@everyone`, `@here`, `@all` (also `@channel`/`@room`/`@online`/`@group`/`@todos`) now trips a `mass-ping` signal in the scorer → the message is removed (and combined with links/scam it climbs to mute + escalate). Previously only **≥5** individual `@`-mentions tripped the mass-mention signal, so a lone `@everyone` — which pings the whole server — slipped through scoring `0`. Detected on raw text at a real mention position, so `name@everyone.com` and `@allan` are **not** flagged; admins are exempt at the bot layer (immune / `TRUSTED` are escalated, not auto-actioned). 6 regression tests added (`examples/moderate-message.ts`).

## [1.0.1] — 2026-06-27

### Security (post-restructure bug hunt)
- **Discord mention injection (@everyone cannon) fixed.** The bot echoes member-controlled text — welcome names and audit-log nicknames — to channels. A new member or nickname set to `@everyone`/`@here` could make the bot mass-ping the server (welcome via `systemChannel.send`) or the log channel (audit sink via `channel.send`), since neither suppressed mentions. Fixed at the right altitude: the Discord `Client` now defaults to `allowedMentions: { parse: [] }`, so no echoed mention from any bot message can notify — mentions still render, they just don't ping. Defense-in-depth: `examples/welcome.ts` `safeName()` now breaks `@`/`#` mention triggers with a zero-width space (covers Telegram `@username` too). Regression test added.

## [1.0.0] — 2026-06-27

### Changed (repackaged as a Claude Code plugin)
- Restructured the repo into a distributable **Claude Code plugin**: added `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` (installable via `/plugin marketplace add`), moved the skill under `skills/community-moderation/` (SKILL.md + examples/resources/templates/docs/tests/rules, self-contained), and kept `agents/` + `commands/` as plugin components at the root.
- Replaced `install.sh` with a Node installer `bin/install.js` (ESM, dependency-free) exposed as the `community-moderation-skill` bin, so `npx community-moderation-skill` vendors the plugin into `./.claude`.
- Updated build config (`tsconfig.json`, `vitest.config.ts`), `package.json` (bin/files/engines/repository + version 1.0.0), and all cross-file references (README, CLAUDE.md, the agent and command) to the new paths. No source logic changed — 230 tests / typecheck / smoke still green.

## [0.6.1] — 2026-06-26

### Fixed (review hardening pass)
- **Ticketing: orphaned-ticket lockout.** A ticket was persisted (counting toward `maxOpenPerUser`) before its Discord channel was created; a failed `channels.create` left the user permanently unable to open a ticket. Now the channel is created inside a `try`, and on failure the ticket is rolled back via the new `TicketStore.remove()`.
- **Ticketing: interaction-ack timeouts.** `handleOpen` now `deferReply()`s before the (slow) channel creation, and `/ticket-delete` acknowledges before building the transcript — both previously risked exceeding Discord's 3 s interaction window, leaving the command "failed" (and, for delete, the channel undeleted).
- **Ticketing: open race.** Rapid double-clicks could bypass `maxOpenPerUser`; `registerTicketing` now reserves an in-flight key synchronously per opener.
- **Discord admin replies: markdown/mention injection.** `!stats` / `!members` / `!immunity` / `!help` wrapped attacker-controlled display names in a code block without escaping backticks, allowing fence breakout (and `@everyone`). Output now neutralizes backticks and sends with `allowedMentions: { parse: [] }`.
- **CSV export: formula injection (CWE-1236).** `toCSV` now prefixes any cell starting with `= + - @ \t \r` with `'`, so a member-controlled name like `=HYPERLINK(...)` can't execute when the roster is opened in Excel/Sheets; the Username column is exported as the bare handle.
- **Audit log: silent drop on cache miss.** The Discord audit sink now falls back to `channels.fetch()` when the log channel isn't cached.
- **Content filters: NEW-member override gap.** `newMemberNoLinks` / `newMemberNoMedia` now upgrade any action weaker than `delete` (not only `allow`), so a configured `warn` no longer lets a brand-new member's link/media survive.

## [0.6.0] — 2026-06-26

### Added
- **Ticketing (MEE6 "Ticketing" parity, Discord).** A transport-agnostic ticket lifecycle core (`examples/ticketing.ts`): panels (publish channel, manager roles, panel embed, button types with per-button categories, intro message, transcript config, `maxOpenPerUser`), a ticket state machine (`open → claimed → closed → reopened → deleted`) with pure `claim`/`close`/`reopen`/`deleteTicket` transitions that fail cleanly on invalid moves, per-panel sequence numbers, a `TicketStore` (+ `InMemoryTicketStore`), manager-role permission checks, command toggles (MEE6 defaults: claim off, close/delete/reopen on), and renderers (`renderIntro`, `ticketChannelName`, `renderTranscript`). discord.js wiring (`examples/discord/ticketing.ts`): a panel button opens a private channel scoped to the opener + manager roles under the configured category, `/ticket-claim|close|reopen|delete` run only inside a ticket channel by a manager, and a transcript is delivered to the transcript channel and/or the opener's DM on close/delete. Reference bot publishes a panel + registers the slash commands via a new `!ticket-setup` admin command (`GuildModeration` intent already added). Config in `templates/foka-config.json` → `ticketing`; spec in `resources/ticketing.md`; covered by `tests/ticketing.test.ts` (16 cases) and the smoke self-test. Transcripts are the one place message content is materialized — by design, kept to the transcript channel and subject to retention.

## [0.5.0] — 2026-06-26

### Added
- **Audit logging (MEE6 "Audit Logging" parity).** `examples/audit-log.ts` routes 24 server-event types across 7 categories (moderation / message / member / role / voice / server / channel) to a logging channel. `shouldLog()` gates on `enabled` → bot-actor filter → ignored channels (message events) → per-event toggle; `formatAuditEntry()` renders a one-line entry; `AuditLogger` dispatches through an **injected sink** (transport stays out of the core, gating/formatting fully testable). Privacy-preserving: logs metadata only — who/what/where/when — **never deleted/edited message content** (unlike MEE6), honoring `privacy.storeRawMessages`. Wired into both bots (channel id from `LOG_CHANNEL` env): `message_deleted` (auto-mod), `member_muted` (auto-mute + impersonation), `member_joined`/`member_left` on both; plus `member_banned` (`GuildBanAdd`) and `nickname_changed`/`member_roles_changed` (`GuildMemberUpdate`) on Discord. Config in `templates/foka-config.json` → `auditLog` (every event toggle + `ignoredChannels`, `dontLogBots`, `dontDisplayThumbnails`); catalog in `resources/audit-log.md`; covered by `tests/audit-log.test.ts` and the smoke self-test.

## [0.4.0] — 2026-06-26

### Added
- **Immunity roles (MEE6 "Immunity Roles" parity).** `examples/immunity.ts` (`isImmune`) exempts a subject from **both** auto-moderation and escalation. Server owner, Administrator-permission roles, listed bot masters, and bots are immune by default (each toggleable); additional immune roles are configured by name or id (normalized: leading `@` stripped, case-insensitive). Wired into both reference bots — Discord maps directly to server roles + `Administrator` + guild owner; Telegram maps chat creator/administrators to owner/admin and matches an admin's `custom_title`, resolving admin status lazily (only when an action would fire, so no extra `getChatMember` call per message). Stronger than `TRUSTED` (which still escalates). Config in `templates/foka-config.json` → `immunity`; policy in `resources/moderation-policy.md` (§ Immunity); injection note in `resources/security.md`; covered by `tests/immunity.test.ts` and the smoke self-test. Immunity is **config-only** — never grantable via chat.
- **`/immunity` · `!immunity` admin command.** Prints the immunity policy (defaults + immune roles) and who's currently immune (Telegram: chat admins; Discord: each immune role's live member count), or checks a single user when used as a reply (Telegram) or with a mention (Discord), returning `✅ immune — <reason>` / `❌ not immune`. Renderers `explainImmunity()` / `formatImmunityPolicy()` added to `examples/immunity.ts`.
- **`/help` · `!help` admin command.** Lists the available admin commands with argument hints and a platform-specific tip, from a single source of truth (`examples/commands-help.ts`, `renderHelp(prefix)`) shared by both bots. Covered by `tests/commands-help.test.ts` and the smoke self-test.

## [0.3.0] — 2026-06-26

### Added
- **Group analytics (Combot "Analytics" parity).** `examples/analytics.ts` turns a `join | leave | message` event log into a period report — joined, left, net growth, messages, active users, average DAU and daily messages, last-joined / last-left lists, and a 7×24 day-of-week × hour activity heatmap — each compared to the immediately preceding equal-length window with Combot-style % change. Includes `formatReport()` and `renderHeatmap()` so an agent can post a `/stats` reply or weekly digest as plain text, and `heatmapPeak()` for the busiest slot. Timezone-aware bucketing via `analytics.tzOffsetMinutes` (no `Intl` dependency, fully deterministic). Privacy-preserving: reads only event type + member id + timestamp, never message content. Config in `templates/foka-config.json` → `analytics`; spec in `resources/analytics.md`; covered by `tests/analytics.test.ts` and the smoke self-test.
- **Member directory (Combot "Users" parity, without XP).** `examples/member-directory.ts` joins member records with per-member message aggregates into a sortable/filterable/paginated roster — ID, Name, Username, MSG (period), AD active-days (`x/N`), Warns, MSG(all), Last msg, Joined, Left, Lang, and **Trust state (replaces XP)** — with Current/All/Left tab counts, `toCSV()` export, and `renderTable()` for chat. Backed by a new append-only `examples/event-log.ts` (`InMemoryEventLog`, retention + hard cap, counts only). `MemberRecord` gains `displayName` and `leftAt`; `MemberStore` gains `all()`, `recordMessage()`, `markLeft()`. Config in `templates/foka-config.json` → `directory`; spec in `resources/member-directory.md`; covered by `tests/member-directory.test.ts` + `tests/event-log.test.ts`.
- **Bots wired for observability.** Both reference bots now record `join`/`leave`/`message` events (kept messages only — removed spam never inflates counts) and expose admin-only commands: **`/stats`** + **`/members [current|all|left]`** on Telegram (gated via `getChatMember`), **`!stats`** + **`!members …`** on Discord (gated via `ManageGuild`). New-member joins capture `displayName`; leaves mark `leftAt`; rejoins clear it.

## [0.2.0] — 2026-06-26

### Added
- **Content-type filters (Combot "Filters" parity).** All 27 Telegram content filters — links, words, RTL chars, commands, games, voice/video/audio, files, channel posts, animated dice, mentions, inline-bot messages, stickers, GIFs, external quotes, stories, images, custom emojis, edited messages, videos, service messages, contacts, forwards, duplicate text, guest mode, message length — encoded as a deterministic filter layer that runs **before** the scam scorer. Config in `templates/foka-config.json` → `contentFilters` (each filter → `allow | warn | delete | mute | kick | ban | off`, strictest action wins); logic in `examples/content-filters.ts` (`detectTelegramFeatures()` → `applyContentFilters()`); full catalog + Telegram-signal mapping in `resources/content-filters.md`. Trust-aware: `NEW`/`FLAGGED` members are auto-restricted by `trust.newMemberNoLinks` / `newMemberNoMedia` even when a filter is set to `allow`. Covered by `tests/content-filters.test.ts` and the smoke self-test.

## [0.1.0] — 2026-06-25

Initial release for the Superteam BR Solana AI Kit skills bounty.

### Added
- Evasion-resistant normalization (homoglyph / zero-width / leet / accent folding) and URL defense (punycode, raw-IP, deep-subdomain, brand-impersonation, blocklist, shortener-unshorten hook); a configurable link **whitelist** (`officialDomains`) whose links are fully exempt — never flagged or penalized, even from new members.
- Multilingual scam lexicon and support taxonomy in **10 languages** (EN/PT/ES/ID/VI/TR/RU/ZH/KO/JA), with script-aware normalization (Cyrillic/Greek folded only in mixed-script tokens so genuine Russian/Greek is preserved; Hangul/kana survive an NFKD→NFC round-trip).
- Optional `confusables-pro` module — full Unicode (TR39) homoglyph coverage via the `confusables` lib, injected behind the same mixed-script gating so the detection core stays dependency-free.
- Deterministic moderation scorer with a member trust-state machine, signal→action matrix, escalation ladder, and raid protocol.
- Support triage (11 tags, P1–P4 SLAs) and persona/channel routing.
- Injection-safe gray-zone LLM adjudicator (injected judge; content passed as data).
- Cross-skill composition (`birdeye`/`helius`/`wallet-analysis`) for on-chain honeypot signals.
- Deploy utilities: `MemberStore`, token-bucket `RateLimiter`, `IdempotencyStore`.
- Contact management: member contact records with a trust lifecycle (`maybePromote`, `vouch`), reputation (`adjustReputation`), relationship tags + lookup (`addTag`/`findByTag`/`findByRole`), and per-contact history (interactions, linked tickets, notes). See `resources/contact-management.md`.
- Reference Telegram (grammY) and Discord (discord.js) bots and an MCP server.
- Security model (prompt-injection, ReDoS, abuse/brigading, privacy, secrets), regression corpus, and CI.

### Added (defense)
- Admin-impersonation defense (`examples/impersonation.ts`): compares each sender's display name / handle against a protected-admin roster on the normalized skeleton (so homoglyph/zero-width look-alike handles are caught). Impersonators are muted (can't message) and escalated; real admins are exempt. Wired into both reference bots; roster in `foka-config.json` → `impersonation.protectedAdmins`.
- Configurable welcome message for new members (`examples/welcome.ts`): placeholder template (`{name}` / `{community}` / `{rules}`) that reinforces the anti-scam golden rules; the joiner's name is sanitized (URLs stripped) so a scammer can't get a link echoed by the bot. Wired into both bots' join events; config in `foka-config.json` → `welcome`.

### Security
- Audited for bugs/vulnerabilities: per-chat idempotency keys (Telegram), scam deletion no longer gated by the self rate-limiter (raid-safe), timed mutes (`until_date`), clock-skew guard, input length cap (anti-DoS), and validated LLM output. Precision pass: word-prefix matching for ASCII classifier keywords (kills mid-word false positives like "api" in "capital", "sign" in "design"), dropped an over-generic VI term, and full Greek+Cyrillic homoglyph coverage via membership check. Trusted members (mods/vouched) are escalated, not auto-deleted/muted (a mod's scam warning contains scam keywords); input is length-capped before URL/mention scanning, not only normalization. Bare (schemeless) homoglyph domains are now extracted via a Unicode-aware matcher and folded for lookalike detection, with an expanded Cyrillic + Greek confusables map (ѕ/і/ј/ԁ/ӏ/ԛ/ԝ/һ + β/γ/η/χ/ω/ϲ/ϱ).
