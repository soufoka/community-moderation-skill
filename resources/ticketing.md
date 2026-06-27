# Ticketing (MEE6 "Ticketing" parity, Discord)

Members open private support tickets from a panel button; ticket managers claim / close / reopen / delete them; a transcript is produced on close. Built as a pure lifecycle core + a discord.js binding.

- **Core (transport-agnostic):** [`examples/ticketing.ts`](../examples/ticketing.ts) — panels, ticket state machine, permission checks, store, renderers, transcript.
- **Discord wiring:** [`examples/discord/ticketing.ts`](../examples/discord/ticketing.ts) — button → private channel, slash commands, transcript delivery.
- **Config:** `templates/foka-config.json` → `ticketing` (panels + command toggles).

## How it maps to the MEE6 panel

| MEE6 field | Here |
|---|---|
| Panel name | `panel.name` |
| Publish Channel | `panel.publishChannel` |
| Ticket Manager Roles | `panel.managerRoles` — who may run the commands |
| Panel message (embed) | `panel.panelMessage` `{ title, description, color }` |
| Ticket types (Buttons) | `panel.types[]` `{ id, label, emoji, color, openCategory?, closedCategory? }` |
| Category for new tickets | `panel.openCategory` (per-button override allowed) |
| Category closed tickets move to | `panel.closedCategory` |
| Ticket introduction message | `panel.introMessage` — `{opener}` `{ticket}` `{panel}` are filled; role mentions kept literal |
| Ticket transcript | `panel.transcript` `{ channel, dmToOpener }` |

## The commands

Slash commands, runnable **only inside a ticket channel by a ticket manager** (MEE6 rule). Toggle them in `ticketing.commands`:

| Command | Default | Effect |
|---|---|---|
| `/ticket-claim` | **off** | Assign the ticket to the running manager |
| `/ticket-close` | on | Move to the closed category, lock the opener, post a transcript |
| `/ticket-reopen` | on | Move back to the open category, unlock the opener |
| `/ticket-delete` | on | Post a final transcript, then delete the channel |

Gating is `isCommandEnabled(config, command)` + `canManageTickets(actorRoles, panel)`. Disabled or non-manager → an ephemeral refusal, no action.

## Lifecycle

```
open ──claim──▶ claimed ──close──▶ closed ──reopen──▶ open/claimed
  └──────────────close──────────────▶ closed
any (open|claimed|closed) ──delete──▶ deleted   (terminal)
```

Transitions are pure (`claim` / `close` / `reopen` / `deleteTicket`) and return `{ ok, error?, ticket }` — invalid moves (claim an already-claimed ticket, reopen an open one, anything on a deleted ticket) fail cleanly with a message instead of throwing. `openTicketForUser` enforces `maxOpenPerUser` (default 1) and assigns a per-panel sequence number.

## Deploying it

```ts
import { InMemoryTicketStore } from '../ticketing';
import { registerTicketing, publishPanel, TICKET_SLASH_COMMANDS } from './ticketing';

const tickets = new InMemoryTicketStore();           // swap for a DB-backed TicketStore
registerTicketing(client, { panel, store: tickets, commands });

// once (admin): register the slash commands + post the panel
await guild.commands.set(TICKET_SLASH_COMMANDS);
await publishPanel(publishChannel, panel);
```

In the reference bot this is one admin command — **`!ticket-setup`** (Manage-Server gated) registers `/ticket-*` and publishes the panel to its channel. Opening a ticket creates a channel that's hidden from `@everyone` and visible to the opener + every manager role (permission overwrites).

## Privacy note

Most of this skill stores **ids, not transcripts**. Tickets are the deliberate exception: a transcript contains message **content** — it's the record the opener asked for by opening a ticket. Keep transcripts to the configured `transcript.channel` (and optionally the opener's DM), and apply `privacy.logRetentionDays`. `renderTranscript()` is the only place content is materialized.

## Notes

- **Multiple panels / buttons.** `ticketing.panels[]` supports several panels; a panel's `types[]` supports several buttons, each with its own category override (e.g. a "Report bug" button routing to a `BUGS` category).
- **Channel name** is `ticket-NNNN` (zero-padded sequence). Override `ticketChannelName()` if you prefer `ticket-username`.
- **Store.** `InMemoryTicketStore` is the reference; implement `TicketStore` against your DB for persistence across restarts.
