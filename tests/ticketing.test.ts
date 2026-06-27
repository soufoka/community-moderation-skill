import { describe, it, expect } from 'vitest';
import {
  InMemoryTicketStore,
  openTicketForUser,
  claim,
  close,
  reopen,
  deleteTicket,
  canManageTickets,
  isCommandEnabled,
  resolveCategories,
  ticketChannelName,
  renderIntro,
  renderTranscript,
  type TicketPanel,
} from '../examples/ticketing';

const panel: TicketPanel = {
  id: 'suporte',
  name: 'Superteam Suporte',
  publishChannel: 'atendimento',
  managerRoles: ['Moderator', 'Core Mods'],
  panelMessage: { title: 'Canal de Suporte', description: 'Abra um ticket' },
  types: [{ id: 'abrir', label: 'Abrir ticket', color: 'red' }, { id: 'bug', label: 'Reportar bug', openCategory: 'BUGS' }],
  introMessage: 'Seu ticket foi criado {opener} @Moderator — bem-vindo a {panel} ({ticket}).',
  openCategory: 'SUPORTE',
  closedCategory: 'SUPORTE',
  maxOpenPerUser: 1,
};

describe('ticketing — open & limits', () => {
  it('opens a ticket with a sequential number', async () => {
    const store = new InMemoryTicketStore();
    const r = await openTicketForUser(store, panel, { id: 'u1', handle: 'foka' });
    expect(r.ok).toBe(true);
    expect(r.ticket?.number).toBe(1);
    expect(r.ticket?.status).toBe('open');
    expect(r.ticket?.id).toBe('suporte-1');
  });

  it('enforces maxOpenPerUser', async () => {
    const store = new InMemoryTicketStore();
    await openTicketForUser(store, panel, { id: 'u1' });
    const second = await openTicketForUser(store, panel, { id: 'u1' });
    expect(second.ok).toBe(false);
    expect(second.error).toContain('already have');
  });

  it('lets a different user open their own ticket', async () => {
    const store = new InMemoryTicketStore();
    await openTicketForUser(store, panel, { id: 'u1' });
    const r = await openTicketForUser(store, panel, { id: 'u2' });
    expect(r.ok).toBe(true);
    expect(r.ticket?.number).toBe(2);
  });

  it('allows a new ticket after the previous one is closed', async () => {
    const store = new InMemoryTicketStore();
    const first = await openTicketForUser(store, panel, { id: 'u1' });
    close(first.ticket!, 'mod');
    await store.update(first.ticket!);
    const r = await openTicketForUser(store, panel, { id: 'u1' });
    expect(r.ok).toBe(true);
  });
});

describe('ticketing — lifecycle transitions', () => {
  it('claim → close → reopen → delete', async () => {
    const store = new InMemoryTicketStore();
    const t = (await openTicketForUser(store, panel, { id: 'u1', handle: 'foka' })).ticket!;

    expect(claim(t, 'modA').ok).toBe(true);
    expect(t.status).toBe('claimed');
    expect(t.claimedBy).toBe('modA');

    expect(close(t, 'modA', 'resolved').ok).toBe(true);
    expect(t.status).toBe('closed');
    expect(t.closeReason).toBe('resolved');

    expect(reopen(t, 'modA').ok).toBe(true);
    expect(t.status).toBe('claimed'); // restores to claimed since it had a claimer
    expect(t.closedAt).toBeUndefined();

    expect(deleteTicket(t, 'modA').ok).toBe(true);
    expect(t.status).toBe('deleted');
  });

  it('rejects claiming a ticket already claimed by someone else', async () => {
    const store = new InMemoryTicketStore();
    const t = (await openTicketForUser(store, panel, { id: 'u1' })).ticket!;
    claim(t, 'modA');
    const r = claim(t, 'modB');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('already claimed by modA');
  });

  it('rejects closing an already-closed ticket and reopening an open one', async () => {
    const store = new InMemoryTicketStore();
    const t = (await openTicketForUser(store, panel, { id: 'u1' })).ticket!;
    close(t, 'mod');
    expect(close(t, 'mod').ok).toBe(false);
    reopen(t, 'mod');
    expect(reopen(t, 'mod').ok).toBe(false); // not closed anymore
  });

  it('reopen of an unclaimed ticket returns it to open', async () => {
    const store = new InMemoryTicketStore();
    const t = (await openTicketForUser(store, panel, { id: 'u1' })).ticket!;
    close(t, 'mod');
    reopen(t, 'mod');
    expect(t.status).toBe('open');
  });

  it('no transition works on a deleted ticket', async () => {
    const store = new InMemoryTicketStore();
    const t = (await openTicketForUser(store, panel, { id: 'u1' })).ticket!;
    deleteTicket(t, 'mod');
    expect(claim(t, 'mod').ok).toBe(false);
    expect(close(t, 'mod').ok).toBe(false);
    expect(deleteTicket(t, 'mod').ok).toBe(false);
  });
});

describe('ticketing — permissions & commands', () => {
  it('only manager-role holders can manage tickets', () => {
    expect(canManageTickets(['Member', 'Moderator'], panel)).toBe(true);
    expect(canManageTickets(['@core mods'], panel)).toBe(true); // normalized
    expect(canManageTickets(['Member'], panel)).toBe(false);
    expect(canManageTickets([], panel)).toBe(false);
  });

  it('command toggles follow MEE6 defaults', () => {
    expect(isCommandEnabled(undefined, 'claim')).toBe(false); // default off
    expect(isCommandEnabled(undefined, 'close')).toBe(true);
    expect(isCommandEnabled({ close: false }, 'close')).toBe(false);
    expect(isCommandEnabled({ claim: true }, 'claim')).toBe(true);
  });
});

describe('ticketing — categories & rendering', () => {
  it('resolves per-button category overrides', () => {
    expect(resolveCategories(panel, 'abrir')).toEqual({ open: 'SUPORTE', closed: 'SUPORTE' });
    expect(resolveCategories(panel, 'bug').open).toBe('BUGS'); // button override
  });

  it('channel name is padded', () => expect(ticketChannelName({ number: 7 })).toBe('ticket-0007'));

  it('intro fills placeholders', async () => {
    const store = new InMemoryTicketStore();
    const t = (await openTicketForUser(store, panel, { id: 'u1', handle: 'foka' })).ticket!;
    const intro = renderIntro(panel, t);
    expect(intro).toContain('@foka');
    expect(intro).toContain('Superteam Suporte');
    expect(intro).toContain('#ticket-0001');
    expect(intro).toContain('@Moderator'); // literal role mention preserved
  });

  it('transcript includes header and message content', async () => {
    const store = new InMemoryTicketStore();
    const t = (await openTicketForUser(store, panel, { id: 'u1', handle: 'foka' })).ticket!;
    claim(t, 'modA');
    close(t, 'modA', 'resolved');
    const out = renderTranscript(panel, t, [
      { author: 'foka', at: '2026-06-26T12:00:00Z', text: 'oi, preciso de ajuda' },
      { author: 'modA', at: '2026-06-26T12:01:00Z', text: 'claro, me conta' },
    ]);
    expect(out).toContain('Transcript — Superteam Suporte ticket-0001');
    expect(out).toContain('Claimed by modA');
    expect(out).toContain('foka: oi, preciso de ajuda');
  });

  it('byChannel finds a stored ticket', async () => {
    const store = new InMemoryTicketStore();
    const t = (await openTicketForUser(store, panel, { id: 'u1' })).ticket!;
    t.channelId = 'chan-123';
    await store.update(t);
    expect((await store.byChannel('chan-123'))?.id).toBe(t.id);
  });

  it('remove() rolls back a ticket so it no longer counts toward maxOpenPerUser', async () => {
    const store = new InMemoryTicketStore();
    const t = (await openTicketForUser(store, panel, { id: 'u1' })).ticket!;
    expect(await store.openCountForUser(panel.id, 'u1')).toBe(1);
    await store.remove(t.id);
    expect(await store.get(t.id)).toBeUndefined();
    expect(await store.openCountForUser(panel.id, 'u1')).toBe(0);
    // user can open again after a failed/rolled-back attempt
    expect((await openTicketForUser(store, panel, { id: 'u1' })).ok).toBe(true);
  });
});
