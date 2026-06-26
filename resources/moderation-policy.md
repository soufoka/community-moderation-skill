# Moderation Policy

The full decision logic behind the summary in `SKILL.md`. All thresholds are defaults — override them in `templates/foka-config.json`.

## Member trust-state transitions

| From | Trigger | To |
|------|---------|-----|
| `NEW` | ≥ `promoteAfterMessages` (default 5) **and** ≥ `promoteAfterDays` (default 2) with no violations | `MEMBER` |
| `NEW` | Vouched by a `TRUSTED` member | `MEMBER` |
| `MEMBER`/`NEW` | 1 soft violation | `FLAGGED` |
| `FLAGGED` | Clean for `flagDecayDays` (default 14) | `MEMBER` |
| any | Timed restriction applied | `MUTED` |
| `MUTED` | Restriction expires | previous state |
| any | High-severity confirmed action | `BANNED` |
| `MEMBER` | Earns role / sustained positive reputation | `TRUSTED` |

## Action matrix (full)

| Signal | Severity | Action (low force → high) | Auto vs human |
|--------|----------|---------------------------|---------------|
| Repeated identical posts (flood) | Low | rate-limit → soft warn | Auto |
| Off-topic promo / unsolicited ad | Low–Med | delete → flag | Auto |
| External link from `NEW`/`FLAGGED` | Medium | delete → warn | Auto |
| Mass @-mentions (≥5) | Medium | delete → flag | Auto |
| Profanity / harassment | Medium | delete → warn → mute | Auto (mute), human (repeat) |
| Known scam pattern (drainer/phish) | High | delete → mute → escalate | Auto delete/mute, **human/known-pattern for ban** |
| Admin impersonation | High | ban → report | **Human-confirm unless high-confidence pattern** |
| Coordinated raid | High | lockdown protocol | Auto lockdown, human review |

## Escalation ladder

`warn → delete → mute (timed) → kick → ban → report`

- Move **one rung at a time** for the same member unless a high-severity scam pattern matches.
- Default mute durations: 1st `1h`, 2nd `24h`, 3rd → kick.
- `kick` is reversible (user may rejoin); `ban` is not — `ban` requires human confirmation or a high-confidence known-pattern match.

## Confidence policy

| Confidence | Allowed automatic actions |
|------------|---------------------------|
| `< 0.6` | warn only (or log-and-watch) |
| `0.6–0.85` | delete, rate-limit, mute (≤24h) |
| `> 0.85` **and** known pattern | escalate for ban; auto-ban only if config `autoBanKnownScam = true` |

Never auto-ban on a single low-confidence signal. When unsure, prefer **delete + explain + flag** over punishment.

**Trusted members are escalated, not auto-actioned.** A `TRUSTED` member (mod/vouched) who trips a scam pattern is almost always *warning others* — scam-warning messages ("never share your seed phrase") contain the same keywords. Flag for human review; never auto-delete/mute a trusted account.

## Raid protocol

**Detect:** ≥ `raidJoinSpike` joins (default 10) within `raidWindowSec` (default 120), or many `NEW` accounts posting similar content.

**Respond (lockdown):**
1. Enable slow mode (e.g., 30s).
2. Restrict `NEW` members to read-only / no media+links.
3. Hold/auto-delete links from accounts younger than `raidAccountAgeDays` (default 7).
4. Notify mods with a summary (count, sample messages, suspected pattern).

**Recover:** lift restrictions after the window is clean for `raidClearMinutes` (default 15); review actions taken; whitelist any false positives.

## Audit

Every action emits a `ModerationAction` log entry (schema in `data-schemas.md`): target, action, reason, signal, confidence, actor (`agent`/`human`), timestamp. Keep logs queryable for appeals and post-mortems.
