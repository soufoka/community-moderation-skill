/**
 * Ticketing — MEE6 "Ticketing" parity (Discord).
 *
 * A transport-agnostic ticket lifecycle: a member opens a ticket from a panel
 * button, a ticket manager claims/closes/reopens/deletes it, and a transcript is
 * produced on close. This module is the pure core (panels, state machine,
 * permission checks, renderers, store) — the discord.js wiring lives in
 * examples/discord/ticketing.ts and calls into here.
 *
 * Pure & dependency-light (only normalizeRole, shared with immunity). Side effects
 * (creating channels, sending messages) are the caller's job.
 */
import { normalizeRole } from './immunity';

export type TicketStatus = 'open' | 'claimed' | 'closed' | 'deleted';
export type ButtonColor = 'blurple' | 'grey' | 'green' | 'red';
export type TicketCommand = 'claim' | 'close' | 'delete' | 'reopen';

export interface TicketButton {
  id: string;
  label: string; // "Abrir ticket"
  emoji?: string;
  color?: ButtonColor;
  openCategory?: string; // overrides panel.openCategory
  closedCategory?: string; // overrides panel.closedCategory
}

export interface PanelMessage {
  title: string; // "Canal de Suporte"
  description: string;
  color?: string;
}

export interface TranscriptConfig {
  channel?: string; // where transcript text/links are posted
  dmToOpener?: boolean; // also DM the opener a copy
}

export interface TicketPanel {
  id: string;
  name: string; // "Superteam Suporte"
  managerRoles: string[]; // @Moderator — who can run ticket commands
  panelMessage: PanelMessage;
  types: TicketButton[]; // one or more "open" buttons
  introMessage: string; // posted inside a new ticket; supports {opener} {ticket} {panel}
  transcript?: TranscriptConfig;
  maxOpenPerUser?: number; // default 1
  // The three fields below are Discord-specific (a guild channel/category structure) and
  // don't apply to a platform with no notion of "channel" or "category" (e.g. WhatsApp's
  // 1:1 intake, examples/whatsapp/bot.ts) — optional rather than every panel faking a value.
  publishChannel?: string; // #atendimento — where the panel embed gets posted
  openCategory?: string; // category for new tickets
  closedCategory?: string; // category closed tickets move to
}

export interface Ticket {
  id: string;
  number: number; // per-panel sequence
  panelId: string;
  type: string; // which button opened it
  channelId?: string; // the created ticket channel
  openerId: string;
  openerHandle?: string;
  status: TicketStatus;
  claimedBy?: string;
  createdAt: string;
  claimedAt?: string;
  closedAt?: string;
  reopenedAt?: string;
  deletedAt?: string;
  closeReason?: string;
}

export interface TicketActionResult {
  ok: boolean;
  error?: string;
  ticket?: Ticket;
}

const now = () => new Date().toISOString();

// ---- command toggles (mirror the MEE6 Commands list) ----

export interface TicketCommandConfig {
  claim?: boolean; // default false in MEE6
  close?: boolean;
  delete?: boolean;
  reopen?: boolean;
}

export const TICKET_COMMANDS: { name: TicketCommand; desc: string }[] = [
  { name: 'claim', desc: 'Claim a ticket' },
  { name: 'close', desc: 'Close a ticket' },
  { name: 'delete', desc: 'Delete a ticket' },
  { name: 'reopen', desc: 'Reopen a closed ticket' },
];

export function isCommandEnabled(config: TicketCommandConfig | undefined, command: TicketCommand): boolean {
  if (!config) return command !== 'claim'; // MEE6 default: claim off, rest on
  return config[command] !== false;
}

/** Can this actor run ticket commands on the panel? (holds a manager role) */
export function canManageTickets(actorRoles: string[] | undefined, panel: Pick<TicketPanel, 'managerRoles'>): boolean {
  const managers = new Set((panel.managerRoles ?? []).map(normalizeRole));
  return (actorRoles ?? []).some((r) => managers.has(normalizeRole(r)));
}

// ---- categories ----

export function resolveCategories(panel: TicketPanel, buttonId?: string): { open?: string; closed?: string } {
  const btn = panel.types.find((b) => b.id === buttonId);
  return { open: btn?.openCategory ?? panel.openCategory, closed: btn?.closedCategory ?? panel.closedCategory };
}

// ---- lifecycle transitions (mutate + return a result; invalid moves are expected) ----

export function claim(ticket: Ticket, managerId: string, at: string = now()): TicketActionResult {
  if (ticket.status === 'deleted') return { ok: false, error: 'ticket is deleted' };
  if (ticket.status === 'closed') return { ok: false, error: 'ticket is closed — reopen it first' };
  if (ticket.claimedBy && ticket.claimedBy !== managerId) return { ok: false, error: `already claimed by ${ticket.claimedBy}` };
  ticket.status = 'claimed';
  ticket.claimedBy = managerId;
  ticket.claimedAt = at;
  return { ok: true, ticket };
}

export function close(ticket: Ticket, _by: string, reason?: string, at: string = now()): TicketActionResult {
  if (ticket.status === 'deleted') return { ok: false, error: 'ticket is deleted' };
  if (ticket.status === 'closed') return { ok: false, error: 'ticket is already closed' };
  ticket.status = 'closed';
  ticket.closedAt = at;
  ticket.closeReason = reason;
  return { ok: true, ticket };
}

export function reopen(ticket: Ticket, _by: string, at: string = now()): TicketActionResult {
  if (ticket.status !== 'closed') return { ok: false, error: 'ticket is not closed' };
  ticket.status = ticket.claimedBy ? 'claimed' : 'open';
  ticket.reopenedAt = at;
  ticket.closedAt = undefined;
  ticket.closeReason = undefined;
  return { ok: true, ticket };
}

export function deleteTicket(ticket: Ticket, _by: string, at: string = now()): TicketActionResult {
  if (ticket.status === 'deleted') return { ok: false, error: 'ticket is already deleted' };
  ticket.status = 'deleted';
  ticket.deletedAt = at;
  return { ok: true, ticket };
}

// ---- store ----

export interface TicketStore {
  create(t: Ticket): Promise<void>;
  get(id: string): Promise<Ticket | undefined>;
  byChannel(channelId: string): Promise<Ticket | undefined>;
  update(t: Ticket): Promise<void>;
  remove(id: string): Promise<void>; // rollback an opened-but-uncreated ticket
  openCountForUser(panelId: string, openerId: string): Promise<number>;
  nextNumber(panelId: string): Promise<number>;
  list(): Promise<Ticket[]>;
}

export class InMemoryTicketStore implements TicketStore {
  private byId = new Map<string, Ticket>();
  private seq = new Map<string, number>();

  async create(t: Ticket): Promise<void> {
    this.byId.set(t.id, t);
  }
  async get(id: string): Promise<Ticket | undefined> {
    return this.byId.get(id);
  }
  async byChannel(channelId: string): Promise<Ticket | undefined> {
    const matches = [...this.byId.values()].filter((t) => t.channelId === channelId);
    if (matches.length === 0) return undefined;
    // A channel id can be reused across multiple ticket records over time (e.g. a 1:1
    // thread — Telegram/WhatsApp — that gets a fresh ticket after a prior one closes), so
    // "first inserted" is not "currently live". Prefer a live ticket; else the most recent.
    const live = matches.find((t) => t.status === 'open' || t.status === 'claimed');
    if (live) return live;
    return matches.reduce((latest, t) => (Date.parse(t.createdAt) > Date.parse(latest.createdAt) ? t : latest));
  }
  async update(t: Ticket): Promise<void> {
    this.byId.set(t.id, t);
  }
  async remove(id: string): Promise<void> {
    this.byId.delete(id);
  }
  async openCountForUser(panelId: string, openerId: string): Promise<number> {
    return [...this.byId.values()].filter(
      (t) => t.panelId === panelId && t.openerId === openerId && (t.status === 'open' || t.status === 'claimed'),
    ).length;
  }
  async nextNumber(panelId: string): Promise<number> {
    const n = (this.seq.get(panelId) ?? 0) + 1;
    this.seq.set(panelId, n);
    return n;
  }
  async list(): Promise<Ticket[]> {
    return [...this.byId.values()];
  }
}

/** Open a ticket for a user, enforcing maxOpenPerUser and assigning a number. */
export async function openTicketForUser(
  store: TicketStore,
  panel: TicketPanel,
  opener: { id: string; handle?: string; type?: string },
): Promise<TicketActionResult> {
  const max = panel.maxOpenPerUser ?? 1;
  const openCount = await store.openCountForUser(panel.id, opener.id);
  if (openCount >= max) return { ok: false, error: `you already have ${openCount} open ticket(s) on this panel` };
  const number = await store.nextNumber(panel.id);
  const type = opener.type ?? panel.types[0]?.id ?? 'default';
  const ticket: Ticket = {
    id: `${panel.id}-${number}`,
    number,
    panelId: panel.id,
    type,
    openerId: opener.id,
    openerHandle: opener.handle,
    status: 'open',
    createdAt: now(),
  };
  await store.create(ticket);
  return { ok: true, ticket };
}

// ---- rendering ----

/** A safe Discord channel name for a ticket, e.g. "ticket-0007". */
export function ticketChannelName(ticket: Pick<Ticket, 'number'>): string {
  return `ticket-${String(ticket.number).padStart(4, '0')}`;
}

/** Render the intro message posted inside a new ticket. {opener} {ticket} {panel} are filled. */
export function renderIntro(panel: TicketPanel, ticket: Ticket): string {
  return panel.introMessage
    .replaceAll('{opener}', ticket.openerHandle ? '@' + ticket.openerHandle.replace(/^@+/, '') : ticket.openerId)
    .replaceAll('{ticket}', '#' + ticketChannelName(ticket))
    .replaceAll('{panel}', panel.name);
}

export interface TranscriptMessage {
  author: string;
  at: string;
  text: string;
}

/**
 * Build a plain-text transcript for a ticket. Unlike most of this skill, a
 * transcript intentionally contains message CONTENT — it's the record the opener
 * asked for by opening a ticket. Keep it to the ticket channel; respect retention.
 */
export function renderTranscript(panel: TicketPanel, ticket: Ticket, messages: TranscriptMessage[]): string {
  const header = [
    `Transcript — ${panel.name} ${ticketChannelName(ticket)}`,
    `Opened by ${ticket.openerHandle ? '@' + ticket.openerHandle.replace(/^@+/, '') : ticket.openerId} at ${ticket.createdAt}`,
    ticket.claimedBy ? `Claimed by ${ticket.claimedBy}` : undefined,
    ticket.closedAt ? `Closed at ${ticket.closedAt}${ticket.closeReason ? ` — ${ticket.closeReason}` : ''}` : undefined,
    '─'.repeat(40),
  ].filter(Boolean);
  const body = messages.map((m) => `[${m.at}] ${m.author}: ${m.text}`);
  return [...header, ...body].join('\n');
}
