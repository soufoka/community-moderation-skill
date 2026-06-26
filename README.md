# Foka AI — Community Moderation Skill

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE) ![Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg) ![Lang](https://img.shields.io/badge/10%20languages-EN%2FPT%2FES%2FID%2FVI%2FTR%2FRU%2FZH%2FKO%2FJA-orange.svg)

**The only community-safety skill in the bounty.** Every Solana project, DAO, and launch runs a Telegram/Discord — and loses users and trust to wallet drainers, seed-phrase phishing, and admin impersonation **every day**. Foka AI is an agent skill that keeps a community **safe** and **answered**: it moderates scams, manages member contacts, triages support, and routes questions to the right person — **safe by design**, with humans gating anything irreversible.

> One agent, four jobs: **moderate** · **manage** · **tag** · **route**.

## Why this matters

Most Solana tooling protects the *chain*. Almost nothing protects the *community channel*, where the actual phishing happens. Foka AI fills that gap with a deterministic, auditable, **evasion-resistant** core in **10 languages** (EN/PT/ES/ID/VI/TR/RU/ZH/KO/JA), plus reference Telegram/Discord bots and an MCP server so an agent (Claude, Cursor, …) can use it directly.

## How it works (in plain English)

Foka AI is a tireless helper that reads every message in your group and asks two things: **is this a scam?** and **does this person need help?**

- **Catching scams.** Scammers disguise their words — swapping letters for look-alikes (a Cyrillic `а` for `a`), sneaking in invisible characters, or writing in other languages. Foka AI first *cleans* each message into a plain form, so `сlаiм` and `claim` look identical to it. Then it checks for the moves that actually drain Solana wallets — fake "verify your wallet" links, "send 1 SOL, get 2 back", people impersonating admins — in **10 languages**.
- **Acting safely.** When it spots a scam it removes the message and quietly alerts the human moderators — but it **never bans anyone on its own**; a human always makes the serious calls. And it won't punish trusted mods (they're usually the ones *warning* about scams).
- **Helping members.** For normal questions ("my wallet won't connect", "where's my payout?") it sorts them by topic and urgency and routes them to the right person.

Open-source (MIT), with 108 automated tests — runs as a Telegram/Discord bot or plugs into AI tools via MCP.

## Features

- **Evasion-resistant detection** — folds homoglyphs (`оrса`→`orca`), zero-width/bidi chars, leetspeak (`s33d`), and accents before matching, so disguises don't slip through.
- **Multilingual (10 languages)** — scam + support lexicons in EN/PT/ES/ID/VI/TR/RU/ZH/KO/JA, with **script-aware** normalization: Cyrillic/Greek fold only in mixed-script tokens (genuine Russian survives), and Hangul/kana survive an NFKD→NFC round-trip. Opt-in [`confusables-pro`](examples/confusables-pro.ts) swaps in the complete Unicode (TR39) table.
- **URL defense** — punycode, raw-IP, deep-subdomain, **brand-impersonation** (`superteam.gift`), blocklist, and a shortener-unshorten hook.
- **Solana scam catalog** — drainers, seed-phrase phishing, admin impersonation, fake giveaways, honeypots — extensible and versioned.
- **Support triage + routing** — 11-tag taxonomy with P1–P4 SLAs and persona/channel routing.
- **Gray-zone LLM adjudication** — ambiguous scores get an optional, **injection-safe** LLM second opinion.
- **Cross-skill composition** — pulls on-chain risk from `birdeye`/`helius`/`wallet-analysis` to expose honeypots a lexicon can't see.
- **Safe by design** — bans/kicks are human-gated; the agent rate-limits itself, ignores other bots, and is idempotent.
- **Deployable** — reference [Telegram](examples/telegram/bot.ts) + [Discord](examples/discord/bot.ts) bots and an [MCP server](examples/mcp/server.ts).

## Quickstart

```bash
npm install
npm test          # vitest — full suite incl. the regression corpus
npm run typecheck # tsc, incl. the reference bots and MCP server
npm run smoke     # quick runnable demo (tsx)
```

Use the logic directly:

```ts
import { moderateMessage } from './examples/moderate-message';

moderateMessage({
  text: 'official support: validate your wallet here',
  memberTrust: 'NEW',
  accountAgeDays: 0,
  officialDomains: ['superteam.fun'],
});
// -> { action: 'mute', severity: 'high', escalate: true, reasons: ['scam:seed-phrase'], ... }
```

## Architecture

```
message ──▶ normalize (anti-evasion) ──▶ score (multilingual lexicon + URL + signals)
                                              │
                          gray zone? ──▶ optional injection-safe LLM judge
                                              │
                                  Decision (action, severity, reasons, escalate)
                                              │
          ┌───────────────────────────────────┼───────────────────────────────────┐
       delete/mute (always)            ban/kick → HUMAN              clean → classify + route
```

The detection core (normalize / moderate / classify) is **pure and dependency-free**; the optional [`confusables-pro`](examples/confusables-pro.ts) module adds full TR39 homoglyph coverage via the `confusables` lib, and transports (grammY/discord.js) + the MCP server are thin adapters. See [SKILL.md](SKILL.md) for the full agent instructions.

## Security

A moderation agent is itself an attack surface. Foka AI treats every message as hostile input: **prompt-injection isolation** (content is data, never instructions), ReDoS-safe matching, anti-brigading, privacy/retention, and least-privilege secrets. Full threat model: [resources/security.md](resources/security.md).

## Testing

Run with `npm test` (vitest). The suite covers normalization/evasion, multilingual scam detection, false-positives, URL defense, the LLM adjudicator, deploy utils, and a **labeled regression corpus** ([examples/eval-cases.ts](examples/eval-cases.ts)) so detection can't silently regress. Extend the corpus with the real evasions you see in the wild.

## Structure

```
community-moderation-skill/
├── SKILL.md                 # Main agent instructions
├── resources/               # Policy, taxonomy, scam catalog, security, schemas
├── docs/                    # Quickstart + triggering eval set
├── examples/                # Pure TS logic + Telegram/Discord bots + MCP server
├── templates/               # foka-config.json
├── tests/                   # vitest suite (+ regression corpus)
├── commands/ agents/ rules/ # Claude Code command, agent, and rules
└── install.sh               # Install into a Claude Code skills directory
```

## Install as a Claude Code skill

```bash
./install.sh                       # -> ~/.claude/skills/community-moderation
./install.sh ./.claude/skills/foka # or a project-local path
```

## Roadmap

- More languages and a maintained confusables table
- Image/QR scam detection (OCR)
- Hosted MCP + a live, shared scam-domain blocklist (cross-community signal)

## License

MIT © 2026 Foka (Superteam BR). Built for the Superteam BR Solana AI Kit skills bounty.
