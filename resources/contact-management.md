# Contact Management

Foka AI keeps a living contact record per community member — the substrate that makes moderation **fair** (trust history) and support **fast** (who is this, what have they asked before). Implemented in [`examples/member-store.ts`](../examples/member-store.ts); schema in [`data-schemas.md`](data-schemas.md).

## The contact lifecycle (trust states)

`NEW → MEMBER → TRUSTED`, with `FLAGGED` / `MUTED` / `BANNED` as needed.

- **Onboarding & promotion** — greet `NEW` members, post rules. `maybePromote()` lifts `NEW → MEMBER` once they're active (`promoteAfterMessages`) and aged (`promoteAfterDays`) with no open warnings.
- **Vouching** — `vouch(rec, byHandle)` lets a `TRUSTED` member promote a `NEW` one straight to `MEMBER` (records who vouched).
- **Decay** — a `FLAGGED` member returns to `MEMBER` after a clean `flagDecayDays` window.

## Reputation

A signed score that rises with helpfulness (resolved tickets, peer reactions) and falls with violations — `adjustReputation()`, and a warning auto-subtracts. Use it to fast-track trusted contributors and keep an eye on repeat offenders.

## Segmentation (tags)

Beyond `roles`, tag contacts by **relationship**: `vip`, `partner`, `investor`, `press`, `contributor`. `addTag()` / `findByTag()` / `findByRole()` pull a segment for targeted outreach or special handling (e.g. never rate-limit a `partner`, fast-lane `press`).

## History

Per contact: `messageCount`, `interactions` (support/mod touchpoints), `lastSeenAt`, linked `ticketIds`, `warnings[]`, and freeform `notes`. This is the context a human (or the agent) needs to answer *"who is this and what's our history?"* before replying or actioning.

## Privacy

Key contacts by the stable `id`, never the handle (handles change). Store only what moderation/support needs, redact PII, and honor delete-on-request — see [`security.md`](security.md).
