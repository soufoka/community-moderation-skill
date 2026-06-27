# Regression Corpus

`examples/eval-cases.ts` holds labeled messages that `examples/selftest.ts` runs on **every change**, so detection can't silently regress. Each case asserts whether `moderateMessage` should escalate (scam) and, optionally, the support tag.

## Coverage today

- **EN + PT scams:** seed-phrase phishing, drainer/claim, doubling, punycode link, prompt-injection.
- **Evasion:** Cyrillic homoglyphs (folded by `normalize.ts`).
- **Legitimate (must NOT punish):** gm/help, payout question (PT), dev question (PT), wallet help (PT).

## How to extend

Add a case to `EVAL_CASES` with: `name`, `text`, optional `trust` / `ageDays`, `expectScam`, optional `expectTag`. Capture the **real** false-positives and new evasions you see in the wild — that is what keeps the lexicon honest. Then run:

```bash
npx tsx examples/selftest.ts
```

## Why this matters

A moderation skill that ships a runnable corpus is **auditable** — the opposite of a toy demo. It also lets you tune thresholds with evidence instead of vibes: change a weight, run the corpus, see what moved.
