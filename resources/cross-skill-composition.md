# Cross-Skill Composition

Foka AI doesn't need to know token internals — it asks the specialists. When a message shills a token mint or wallet address, enrich it via **other skills in this repo**, then feed the verdict back into moderation. Implemented in `examples/enrich-token.ts`.

## Flow

1. `extractMints(text)` → candidate mints / addresses (Solana base58).
2. Look each up via repo skills:
   - **`birdeye`** / **`helius`** → liquidity, age, holders, mint/freeze authority.
   - **`wallet-analysis`** → address reputation / known-bad lists.
3. `assessToken(mint, lookup)` → `{ scam, reasons }`.
4. `moderateMessage({ …, externalSignals: { tokenScam } })` → on-chain risk raises the score.
5. Act per the matrix — bans still human-gated.

## Honeypot heuristic (`assessToken`)

Red flags: `freeze-authority-active`, `mint-authority-active`, `very-low-liquidity`, `brand-new-token`, `few-holders`. **Two or more** ⇒ treat as a scam signal. Tune thresholds per community.

## Why it matters

A pump/honeypot shill reads as innocent text to any lexicon — only **on-chain data** exposes it. By composing with data skills instead of guessing, the moderation agent gets dramatically better at the scam that actually costs your community money. This ecosystem fit is exactly what the bounty rewards.
