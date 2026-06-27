# Member directory (Combot "Users" parity, without XP)

A sortable, filterable, paginated **roster** of every member — the same table Combot shows under *Users*, minus the XP column. Built by joining each `MemberRecord` with its message aggregates from the event log.

- **Config:** `templates/foka-config.json` → `directory`.
- **Logic:** [`examples/member-directory.ts`](../examples/member-directory.ts) — `buildDirectory()`, `toCSV()`, `renderTable()`.
- **Data:** member records ([`examples/member-store.ts`](../examples/member-store.ts)) + the group event log ([`examples/event-log.ts`](../examples/event-log.ts)).

## Columns

| Column | Source | Combot |
|---|---|---|
| **ID** | `MemberRecord.id` (stable platform id) | ID |
| **Name** | `displayName` (falls back to handle) | Name |
| **Username** | `handle` | Username |
| **MSG** | messages sent **in the period** | MSG△ |
| **AD** | distinct **active days** in the window → `x/N` | AD |
| **Warns** | `warnings.length` | Warns |
| **MSG(all)** | `messageCount` (all-time) | MSG (all) |
| **Last msg** | most recent message timestamp | Last msg. |
| **Joined** | `joinedAt` | Joined |
| **Left** | `leftAt` (set when they leave) | Left |
| **Lang** | `language` | Lang. |
| **Trust** | `trustState` | — (replaces XP) |

> **No XP.** Combot's XP column is dropped on purpose. The moderation-relevant signal is `trustState` (NEW → MEMBER → TRUSTED, plus FLAGGED/MUTED/BANNED). Per-member `reputation` still exists in contact management but is intentionally kept off this roster.

## Filters, sort, pagination

```ts
buildDirectory(members, events, period, {
  filter: 'current',   // 'current' (still in group) | 'all' | 'left'
  sort: 'lastMsg',     // name | msga | activeDays | warns | msgAll | lastMsg | joined | left
  desc: true,
  page: 1,
  perPage: 50,         // Combot's default
  tzOffsetMinutes: -180,
});
```

Returns a `DirectoryPage`: `{ rows, total, page, perPage, pages, counts: { current, left, all }, period }`. The `counts` drive the **Current members / All / Left** tab badges.

## Export & display

- `toCSV(rows)` → the **Export** button: `ID,Name,Username,MSG,AD,Warns,MSG(all),Last msg,Joined,Left,Lang,Trust` (no XP). Cells are quote-escaped; `AD` renders as `2/7`.
- `renderTable(rows)` → a monospaced table (compact column subset) an agent can drop straight into a `<pre>` / code block in chat.

## Live in the bots

Both reference bots expose admin-only commands fed by the same event log:

| Command | Does |
|---|---|
| `/help` (Telegram) · `!help` (Discord) | List the admin commands |
| `/stats` (Telegram) · `!stats` (Discord) | Group analytics dashboard ([`resources/analytics.md`](analytics.md)) |
| `/members [current\|all\|left]` · `!members …` | This roster, most-recently-active first |
| `/immunity [reply\|@user]` · `!immunity [@user]` | Immunity policy + who's immune; checks one user ([`resources/moderation-policy.md`](moderation-policy.md#immunity-allowlist)) |

Gating: Telegram checks `getChatMember` status (`administrator`/`creator`); Discord checks the `ManageGuild` permission. Events are recorded as they happen — `join` on member-add, `leave` on member-remove, and `message` only for **kept** messages (removed spam never inflates the counts) — carrying ids/handles/timestamps only, never message content.

## Notes

- **`lastMsgAt`** falls back to `MemberRecord.lastSeenAt` when the member sent nothing inside the window, so the column is never empty for an active account.
- **Window** is whatever `period` you pass (the bots use the last 7 days); `AD`'s denominator `N` = days in that window.
- **Privacy:** like analytics, the roster is counts-only. Don't add a "last message text" column — keep transcripts out (see [`resources/security.md`](security.md)).
