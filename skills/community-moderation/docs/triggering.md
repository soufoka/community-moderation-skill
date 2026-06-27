# Triggering

What makes an agent load this skill is the `description` in `SKILL.md`. These are the trigger cases used to tune it (skill-creator methodology): prompts that **should** load `community-moderation`, and look-alikes that should **not** (to avoid stealing other skills' intents).

## Should load (positive)

- "set up a moderation bot for our Telegram group"
- "how do I stop scam / drainer links in our Discord?"
- "someone is impersonating an admin and DMing members"
- "we just got raided — what do I do?"
- "triage and route support questions in our community"
- "detect seed-phrase phishing in chat"
- PT: "como modero meu grupo do Telegram?"
- PT: "tem gente mandando golpe de airdrop no grupo"
- PT: "como organizo o suporte/atendimento da comunidade?"

## Should NOT load (negative — belongs to other skills)

- "swap SOL for USDC" → `jupiter` / `drift`
- "what's the price of BONK?" → `birdeye` / `pyth`
- "write a launch tweet" → marketing/general
- "deploy my anchor program" → dev skills

## Why the description works

It leads with the **verbs** (moderate, detect, manage, triage, route) and the **nouns** (Telegram, Discord, spam, scam, drainer, raid, impersonation, support, persona) that show up in real requests — in **EN + PT** — and scopes itself away from on-chain/data/marketing intents. Every positive case above maps to a phrase already present in the `description`.

## Formal benchmark

To benchmark triggering accuracy and iterate the `description` automatically, run the `skill-creator` eval against this set (positive cases should load, negatives should not). Treat this file as the regression set for triggering, just as `eval-cases.ts` is for detection.
