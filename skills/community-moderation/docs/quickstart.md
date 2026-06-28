# Quickstart (5 minutes)

> **Install as a plugin (all projects):** `/plugin marketplace add soufoka/community-moderation-skill` then `/plugin install community-moderation-skill@foka`. The steps below are for running the **reference bot**.

1. **Copy the config** and fill the placeholders (official domains, protected admins, immunity roles, personas, channels, mod/log/transcript channels):
   ```bash
   cp skills/community-moderation/templates/foka-config.json foka-config.json
   ```
   Key blocks: `moderation` (incl. `bannedSubstrings` + `massPingTokens`), `contentFilters`, `immunity`, `auditLog`, `analytics`, `ticketing`, `welcome`, `routing`.
2. **Set secrets** — never commit them:
   ```bash
   export BOT_TOKEN=...     # Telegram   (Discord: DISCORD_TOKEN)
   export LOG_CHANNEL=...   # audit-log channel id (optional)
   ```
3. **Install a transport:**
   ```bash
   npm i grammy            # Telegram   (Discord: npm i discord.js)
   ```
4. **Wire it up** — see [`../examples/telegram/bot.ts`](../examples/telegram/bot.ts) / [`../examples/discord/bot.ts`](../examples/discord/bot.ts). The core calls are platform-agnostic:
   ```ts
   moderateMessage({ text, memberTrust, accountAgeDays, officialDomains, massPingTokens }) // -> Decision
   applyContentFilters(features, contentFilters, ctx)  // -> content-type filter action
   isImmune(subject, immunity)                         // -> admins exempt from moderation
   classifyMessage(text)                               // -> { tag, priority }  (then routeToPersona)
   ```
5. **Admin commands** (managers only) ship wired into both reference bots:

   | Telegram | Discord | Does |
   |---|---|---|
   | `/help` | `!help` | list the admin commands |
   | `/stats` | `!stats` | group analytics + activity heatmap (last 7 days) |
   | `/members [current\|all\|left]` | `!members …` | member roster (ID, MSG, active days, warns, trust) |
   | `/immunity [reply\|@user]` | `!immunity [@user]` | immunity policy + who's exempt, or check one user |
   | — | `!ticket-setup` | publish the ticket panel + register the `/ticket-*` commands |

6. **Verify behavior** before going live:
   ```bash
   npm run smoke   # evasion, multilingual scams, @everyone guard, false-positives, no auto-ban
   npm test        # full vitest suite (240)
   ```
7. **Roll out safely:** start in **log-only** mode (compute decisions, don't enforce), watch the `escalate` stream for a day, then enable enforcement. Keep `ban`/`kick` **human-gated** and put real admins on the `immunity` list so they're never auto-actioned (see [`../resources/security.md`](../resources/security.md)).
