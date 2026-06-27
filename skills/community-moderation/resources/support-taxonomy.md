# Support Taxonomy

Every inbound question gets exactly one **tag** and a **priority**. Tags drive routing (see `SKILL.md` Pillar 4 and `examples/classify-and-route.ts`).

## Priority definitions

| Priority | Meaning | Target first response |
|----------|---------|-----------------------|
| `P1` | Money/access at risk (lost payout, locked account) | < 1h |
| `P2` | Blocked on a core task (can't submit, wallet/tx issue) | < 4h |
| `P3` | Important but not blocking (dev question, partnership) | < 24h |
| `P4` | Low (feedback, off-topic) | Best effort |

## Tags

| Tag | Description | Example | Priority | Routes to |
|-----|-------------|---------|----------|-----------|
| `payout-issue` | Reward/payment not received or wrong | "I won a bounty last week, still no USDC" | P1 | Ops / finance |
| `wallet-help` | Wallet connect/signing problems | "Phantom won't connect to the site" | P2 | Support |
| `transaction-issue` | Failed/stuck/pending tx | "my tx is stuck pending 20 min" | P2 | Support |
| `submission-help` | How to enter/submit, deadlines | "how do I submit to the listing?" | P2 | Bounty lead |
| `bounty-question` | Eligibility, prize, rules | "is this bounty global?" | P2 | Bounty lead |
| `technical-dev` | API/SDK/RPC/program integration | "which RPC for devnet?" | P3 | Dev |
| `bug-report` | Something broken on a product | "the dashboard 500s on login" | P3 | Dev |
| `partnership` | Collab/sponsor/listing requests | "we'd like to sponsor a bounty" | P3 | BD |
| `feedback` | Suggestions / feature ideas | "you should add X" | P4 | Product |
| `off-topic` | Not a support request | general chatter | P4 | Close |
| `spam` | Promo/scam/noise | — | P4 | Moderate (see scam-patterns) |

## Rules

- **One tag per request.** If two fit, pick the higher-priority one.
- **Dedupe first.** Before opening a ticket, search open tickets and the known-issues list; if found, link the member to it instead of creating a duplicate.
- **Escalate on signal,** not volume: a single `payout-issue` is P1 even if it's the only one.
- **Ambiguous?** Default to `off-topic` → triage persona, never guess a wrong owner.
- Keep keywords in `templates/foka-config.json` so the taxonomy stays editable without code changes.
