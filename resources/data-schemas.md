# Data Schemas

Minimal schemas the agent reads/writes. Shown as TypeScript interfaces; persist them however you like (KV, SQLite, Postgres). Keep only what moderation/support needs — see the privacy note in `SKILL.md`.

## MemberRecord

```ts
interface MemberRecord {
  id: string;                 // platform user id (telegram/discord) — the stable key
  handle: string;             // @username — the "Username" column (may change — id is the key)
  displayName?: string;       // the "Name" column (first+last / server nick)
  platform: 'telegram' | 'discord';
  joinedAt: string;           // ISO — first seen
  lastSeenAt: string;         // ISO — last activity
  leftAt?: string;            // ISO — set when the member leaves (drives the "Left" roster tab)
  trustState: 'NEW' | 'MEMBER' | 'TRUSTED' | 'FLAGGED' | 'MUTED' | 'BANNED';
  roles: string[];            // e.g. ['mod', 'contributor']
  tags: string[];             // relationship/segments: 'vip', 'partner', 'press'
  reputation: number;         // signed score; rises with helpfulness, falls with violations
  messageCount: number;
  interactions: number;       // support/mod touchpoints
  warnings: Warning[];
  ticketIds: string[];        // linked SupportTicket ids
  language?: string;          // detected/declared, e.g. 'pt'
  links?: Record<string, string>; // e.g. { x: '@handle' }
  vouchedBy?: string;         // handle of a TRUSTED voucher
  mutedUntil?: string;        // ISO, if MUTED
  notes?: string;             // freeform mod notes
}

interface Warning {
  at: string;                 // ISO
  reason: string;
  signal: string;             // e.g. 'link-from-untrusted'
  actor: 'agent' | 'human';
}
```

## SupportTicket

```ts
interface SupportTicket {
  id: string;
  fromMemberId: string;
  tag: string;                // from support-taxonomy.md
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  status: 'open' | 'routed' | 'resolved' | 'duplicate';
  channel: string;            // where it was routed
  assignedPersona?: string;
  summary: string;            // one-line problem
  links: string[];            // related tickets / known-issue refs
  createdAt: string;          // ISO
  resolvedAt?: string;
}
```

## ModerationAction (audit log)

```ts
interface ModerationAction {
  id: string;
  targetMemberId: string;
  action: 'warn' | 'delete' | 'mute' | 'kick' | 'ban' | 'lockdown';
  reason: string;
  signal: string;             // matched signal/pattern id
  confidence: number;         // 0..1
  actor: 'agent' | 'human';
  at: string;                 // ISO
  reversedAt?: string;        // set if appealed/undone
}
```

## RoutingConfig

```ts
interface RoutingConfig {
  routes: Record<string, { persona: string; channel: string }>; // tag -> owner
  defaultPersona: string;
  defaultChannel: string;
}
```

> `id` is the stable key — usernames/handles change. Index members by platform `id`, never by handle.
