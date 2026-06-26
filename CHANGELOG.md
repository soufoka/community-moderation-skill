# Changelog

All notable changes to this skill are documented here.

## [0.1.0] — 2026-06-25

Initial release for the Superteam BR Solana AI Kit skills bounty.

### Added
- Evasion-resistant normalization (homoglyph / zero-width / leet / accent folding) and URL defense (punycode, raw-IP, deep-subdomain, brand-impersonation, blocklist, shortener-unshorten hook).
- Multilingual scam lexicon and support taxonomy in **8 languages** (EN/PT/ES/ID/VI/TR/RU/ZH), with script-aware normalization (Cyrillic/Greek folded only in mixed-script tokens, so genuine Russian/Greek is preserved).
- Deterministic moderation scorer with a member trust-state machine, signal→action matrix, escalation ladder, and raid protocol.
- Support triage (11 tags, P1–P4 SLAs) and persona/channel routing.
- Injection-safe gray-zone LLM adjudicator (injected judge; content passed as data).
- Cross-skill composition (`birdeye`/`helius`/`wallet-analysis`) for on-chain honeypot signals.
- Deploy utilities: `MemberStore`, token-bucket `RateLimiter`, `IdempotencyStore`.
- Reference Telegram (grammY) and Discord (discord.js) bots and an MCP server.
- Security model (prompt-injection, ReDoS, abuse/brigading, privacy, secrets), regression corpus, and CI.

### Security
- Audited for bugs/vulnerabilities: per-chat idempotency keys (Telegram), scam deletion no longer gated by the self rate-limiter (raid-safe), timed mutes (`until_date`), clock-skew guard, input length cap (anti-DoS), and validated LLM output.
