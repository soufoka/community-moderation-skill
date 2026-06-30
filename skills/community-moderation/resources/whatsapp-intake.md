# WhatsApp support intake (compliant scope, read this first)

## What this is NOT

WhatsApp has **no API — official or unofficial-but-safe — for reading or moderating a group chat.** The Business Cloud API (the only API Meta supports) is built for **1:1 business conversations**, not group automation. Unofficial libraries (Baileys, whatsapp-web.js) that automate a personal/group account **violate WhatsApp's Terms of Service** and risk the number being banned — and even they can't delete another person's message; WhatsApp doesn't expose that to anyone.

So: **this skill does not, and cannot compliantly, moderate a WhatsApp group** the way it moderates Telegram/Discord (no delete, no mute, no kick, no message reading in a group). Don't represent it as such.

## What this IS

A **member-initiated, 1:1 support & scam-check channel** on the official WhatsApp Business Cloud API — exactly the API's intended use case. A community member DMs the official WhatsApp Business number and the bot:

1. **Scam-check** — if the message looks like a forwarded link/claim ("is this a scam?", "isso é golpe?", or just contains a URL), it's scored by the **same** scorer used for Telegram/Discord (`moderateMessage` + `scanUrls`) and the member gets an advisory reply. **No action is taken** — there's no group to act in; it's purely informational, same posture as the existing "humans/community decide, the agent informs" principle.
2. **Support ticket** — otherwise, the message is classified (`classifyMessage`) and routed (`routeToPersona`) into the **same ticketing core** (`examples/ticketing.ts`) the Discord ticket panels use. The WhatsApp conversation itself *is* the "channel" — no channel gets created, `ticket.channelId` is just the sender's `wa_id`.

Both paths reuse the **same** `MemberStore`, `TicketStore`, and `EventLog` as Telegram/Discord, so a WhatsApp contact shows up in the same member roster and the same analytics as everyone else, on a unified id space (just tagged `platform: 'whatsapp'`).

## What does NOT apply on WhatsApp

- **No join/leave events.** There's no group, so `EventLog` only ever records `'message'` events for WhatsApp contacts — joins/leaves stay at 0 for this platform. Don't expect `/stats` joined/left counts to include WhatsApp.
- **No content filters, immunity roles, or audit-log group events** (those are all about *group* moderation — they don't have a WhatsApp equivalent because there's no group surface).
- **No mass-ping guard** — there's no `@everyone` on a 1:1 DM.

## Setup

1. Create a Meta App with the **WhatsApp** product. Get a `phone_number_id` and a **permanent** access token (a System User token, not a 24h test token).
2. Note your **App Secret** (Meta App → Settings → Basic) — required for webhook signature verification.
3. Pick your own `WHATSAPP_VERIFY_TOKEN` string; Meta echoes it back during the webhook handshake (`GET /webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`).
4. Point the Meta App's webhook URL at `examples/whatsapp/bot.ts`'s `/webhook` route (use a tunnel — ngrok, Cloudflare Tunnel — in development; Meta requires HTTPS).
5. Run:
   ```bash
   WHATSAPP_TOKEN=... WHATSAPP_PHONE_ID=... WHATSAPP_VERIFY_TOKEN=... WHATSAPP_APP_SECRET=... npx tsx examples/whatsapp/bot.ts
   ```

Config (non-secret) lives in `templates/foka-config.json` → `whatsapp`. **Never** put the token/verify-token/app-secret in that file — they're env-only, like `BOT_TOKEN`/`DISCORD_TOKEN`/`LOG_CHANNEL` for the other bots.

## Security

- **Every inbound webhook is signature-verified** (`verifyWebhookSignature` in `examples/whatsapp-intake.ts`) against the raw request body using `X-Hub-Signature-256` (HMAC-SHA256 with your App Secret, constant-time compared). An unsigned or forged POST gets `401` and is never processed — without this, anyone who finds your webhook URL could inject fake messages.
- The webhook handler **acks `200` immediately**, then processes — Meta retries on slow/failed responses, and a slow LLM/network call shouldn't cause duplicate webhook redelivery storms.
- Message content is still **data, never instructions** — same prompt-injection posture as the rest of the skill (see `resources/security.md`).

## Privacy

Same posture as the rest of the skill: store ids (the `wa_id`) and counts, not transcripts, beyond what the open ticket needs. The scam-check path never stores the forwarded link/text beyond the reply round-trip.

## Files

- [`examples/whatsapp-intake.ts`](../examples/whatsapp-intake.ts) — pure core: webhook payload parsing, scam-check vs. support-ticket routing decision, reply rendering, signature verification. Fully unit-tested (`tests/whatsapp-intake.test.ts`).
- [`examples/whatsapp/bot.ts`](../examples/whatsapp/bot.ts) — the thin Cloud API transport (HTTP server, signature gate, `fetch` calls to the Graph API). Reuses `ticketing.ts` / `classify-and-route.ts` / `member-store.ts` / `event-log.ts` verbatim — no platform-specific forks of the core logic.
