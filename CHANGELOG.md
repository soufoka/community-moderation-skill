# Changelog

All notable changes to this skill are documented here.

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
