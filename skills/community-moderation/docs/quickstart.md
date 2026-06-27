# Quickstart (5 minutes)

1. **Copy the config** and fill the placeholders (officialDomains, personas, channels, modChannel):
   ```bash
   cp templates/foka-config.json foka-config.json
   ```
2. **Set the bot token** — never commit it:
   ```bash
   export BOT_TOKEN=123456:your-token   # PowerShell: $env:BOT_TOKEN="..."
   ```
3. **Install a transport:**
   ```bash
   npm i grammy            # Telegram   (Discord: npm i discord.js)
   ```
4. **Wire it up** — see [`examples/telegram/bot.ts`](../examples/telegram/bot.ts). The core calls are platform-agnostic:
   ```ts
   moderateMessage({ text, memberTrust, accountAgeDays, officialDomains }) // -> Decision
   classifyMessage(text)                                                   // -> { tag, priority }
   routeToPersona(classification, config, member, summary)                 // -> handoff
   ```
5. **Verify behavior** before going live:
   ```bash
   npx tsx examples/selftest.ts   # evasion, EN/PT scams, false-positives, no auto-ban
   ```
6. **Roll out safely:** start in **log-only** mode (compute decisions, don't enforce), watch the `escalate` stream for a day, then enable enforcement. Keep `ban`/`kick` **human-gated** (see [`resources/security.md`](../resources/security.md)).
