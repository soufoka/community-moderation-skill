# Group analytics (Combot "Analytics" parity)

Turn a stream of group **events** into the same dashboard Combot shows: growth, engagement, and an activity heatmap — each compared to the immediately preceding window.

- **Config:** `templates/foka-config.json` → `analytics`.
- **Logic:** [`examples/analytics.ts`](../examples/analytics.ts) — `buildReport()` plus `formatReport()` / `renderHeatmap()` for presenting it in chat.
- **Privacy first:** analytics reads only an event's **type, member id, and timestamp** — never message content. It fits the "store ids, not transcripts" rule in [`resources/security.md`](security.md).

## Input: a group event log

Feed it whatever your bot already sees, reduced to:

```ts
interface GroupEvent {
  type: 'join' | 'leave' | 'message';
  memberId: string;
  handle?: string;       // for the last-joined / last-left lists
  displayName?: string;
  at: string;            // ISO timestamp
}
```

Append one event per join, leave, and message. No text is stored. Keep events for `analytics.retentionDays`, then roll up to aggregates and drop the raw rows.

## Output: the report

`buildReport(events, period, opts)` returns:

| Field | Meaning | Combot tile |
|---|---|---|
| `joined` | new members in the window | **Joined** |
| `left` | members who left | **Left** |
| `netGrowth` | `joined − left` | — |
| `messages` | total messages | **Messages** |
| `activeUsers` | unique members who sent ≥1 message | **Active users** |
| `avgDAU` | mean daily unique active users | **Avg. DAU** |
| `avgDailyMessages` | `messages / days` | **Avg. daily msgs** |
| `lastJoined` / `lastLeft` | most recent N members | **Last joined / Last left** |
| `heatmap` | 7 × 24 grid of message counts (day-of-week × hour) | **Activity heatmap** |

Each `Metric` is `{ value, previous, deltaPct }`, where `previous` is the same metric over the preceding equal-length window and `deltaPct` is the Combot-style percentage change (e.g. `106` vs `58` → `+82.76%`). When there is no baseline (previous `0`, current `> 0`), `deltaPct` is `null` and renders as `new`.

## Timezone

Daily buckets and the heatmap depend on the timezone. Set `analytics.tzOffsetMinutes` (e.g. `-180` for UTC-3 / BRT). Bucketing is done by shifting the UTC timestamp by the offset — deterministic, no `Intl` dependency, so the same events always yield the same grid.

## Wiring (illustrative)

```ts
import { buildReport, formatReport, renderHeatmap, heatmapPeak } from './analytics';

// 1. record events as they happen (grammY)
bot.on('chat_member', (ctx) => { /* push {type:'join'|'leave', memberId, handle, at} */ });
bot.on('message', (ctx) => { /* push {type:'message', memberId, at} — no text */ });

// 2. report on demand / on a schedule
const period = { from: '2026-06-20T00:00:00Z', to: '2026-06-27T00:00:00Z' };
const report = buildReport(events, period, { tzOffsetMinutes: -180, lastN: 5 });

console.log(formatReport(report));   // headline tiles
console.log(renderHeatmap(report.heatmap));
const peak = heatmapPeak(report.heatmap); // e.g. { dow: 2, hour: 14, count: 16 } → busiest TUE 14h
```

`formatReport` renders the dashboard tiles as text; `renderHeatmap` renders the day×hour grid with shaded blocks (` ·░▒▓█`). Both are plain strings, so an agent can post them straight into a mod channel or a `/stats` reply.

## Notes & gotchas

- **Active users vs Avg DAU.** `activeUsers` is unique members across the *whole* window; `avgDAU` is the average *per day*. A 7-day window can show 22 active users but an Avg DAU of 3.
- **Previous period is automatic** — the equal-length window immediately before `from`. Override by passing a different `period` if you want a custom comparison.
- **Empty windows are safe:** all metrics return `0`, `deltaPct` handles divide-by-zero (`0` vs `0` → `0%`; `n` vs `0` → `new`).
- **Not a leaderboard.** Per-member ranking (top posters) is intentionally out of scope here — keep that in contact/reputation ([`resources/contact-management.md`](contact-management.md)) so analytics stays aggregate and low-PII.
