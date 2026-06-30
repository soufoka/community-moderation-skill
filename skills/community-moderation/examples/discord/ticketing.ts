/**
 * Discord ticketing wiring (discord.js v14) — binds the pure core in
 * examples/ticketing.ts to real Discord: a panel button opens a private ticket
 * channel; ticket managers run /ticket-claim|close|reopen|delete; a transcript is
 * produced on close/delete.
 *
 * Install: npm i discord.js
 * Register the slash commands once with TICKET_SLASH_COMMANDS (see bot.ts).
 */
import {
  Client,
  Events,
  ButtonInteraction,
  ChatInputCommandInteraction,
  TextChannel,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  SlashCommandBuilder,
  GuildMember,
  type OverwriteResolvable,
  type ColorResolvable,
} from 'discord.js';
import {
  TicketPanel,
  TicketStore,
  TicketCommandConfig,
  TicketCommand,
  ButtonColor,
  TranscriptMessage,
  TICKET_COMMANDS,
  openTicketForUser,
  resolveCategories,
  canManageTickets,
  isCommandEnabled,
  claim,
  close,
  reopen,
  deleteTicket,
  ticketChannelName,
  renderIntro,
  renderTranscript,
  type Ticket,
} from '../ticketing';

export interface TicketingDeps {
  panel: TicketPanel;
  store: TicketStore;
  commands?: TicketCommandConfig;
}

/** Slash command definitions to register with Discord (once, e.g. on ready). */
export const TICKET_SLASH_COMMANDS = TICKET_COMMANDS.map((c) =>
  new SlashCommandBuilder().setName(`ticket-${c.name}`).setDescription(c.desc).toJSON(),
);

function mapColor(c?: ButtonColor): ButtonStyle {
  switch (c) {
    case 'green': return ButtonStyle.Success;
    case 'red': return ButtonStyle.Danger;
    case 'grey': return ButtonStyle.Secondary;
    default: return ButtonStyle.Primary;
  }
}

function findCategoryId(guild: ButtonInteraction['guild'], name: string | undefined): string | undefined {
  if (!name) return undefined; // panel has no category for this platform/panel (e.g. unset on purpose)
  return guild?.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === name.toLowerCase(),
  )?.id;
}

/** Post the panel (embed + open button(s)) to a channel so members can open tickets. */
export async function publishPanel(channel: TextChannel, panel: TicketPanel): Promise<void> {
  const embed = new EmbedBuilder().setTitle(panel.panelMessage.title).setDescription(panel.panelMessage.description);
  if (panel.panelMessage.color) embed.setColor(panel.panelMessage.color as ColorResolvable);
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const b of panel.types) {
    const btn = new ButtonBuilder().setCustomId(`ticket:open:${b.id}`).setLabel(b.label).setStyle(mapColor(b.color));
    if (b.emoji) btn.setEmoji(b.emoji);
    row.addComponents(btn);
  }
  await channel.send({ embeds: [embed], components: [row] });
}

/** Attach the ticketing interaction handlers to the client. */
export function registerTicketing(client: Client, deps: TicketingDeps): void {
  const opening = new Set<string>(); // in-flight opens, to serialize a user's rapid double-clicks
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isButton() && interaction.customId.startsWith('ticket:open:')) {
        const key = `${deps.panel.id}:${interaction.user.id}`;
        if (opening.has(key)) {
          // Synchronous reservation BEFORE any await closes the open race (maxOpenPerUser).
          await interaction.reply({ content: '⏳ Your ticket is already being created…', ephemeral: true });
          return;
        }
        opening.add(key);
        try {
          await handleOpen(interaction, deps);
        } finally {
          opening.delete(key);
        }
      } else if (interaction.isChatInputCommand() && interaction.commandName.startsWith('ticket-')) {
        await handleCommand(interaction, deps);
      }
    } catch (err) {
      console.error('ticketing error', err);
    }
  });
}

async function handleOpen(interaction: ButtonInteraction, deps: TicketingDeps): Promise<void> {
  const { panel, store } = deps;
  const guild = interaction.guild;
  if (!guild) return;
  const buttonId = interaction.customId.slice('ticket:open:'.length);
  await interaction.deferReply({ ephemeral: true }); // ack within 3s — channel creation can be slow

  const res = await openTicketForUser(store, panel, { id: interaction.user.id, handle: interaction.user.username, type: buttonId });
  if (!res.ok || !res.ticket) {
    await interaction.editReply(`⚠️ ${res.error ?? 'could not open ticket'}`);
    return;
  }
  const ticket = res.ticket;
  const cats = resolveCategories(panel, buttonId);

  // Private channel: hide from @everyone, allow the opener + every manager role.
  const overwrites: OverwriteResolvable[] = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
  ];
  for (const roleName of panel.managerRoles) {
    const role = guild.roles.cache.find((r) => r.name.toLowerCase() === roleName.replace(/^@+/, '').toLowerCase());
    if (role) overwrites.push({ id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  }

  try {
    const channel = await guild.channels.create({
      name: ticketChannelName(ticket),
      type: ChannelType.GuildText,
      parent: findCategoryId(guild, cats.open),
      permissionOverwrites: overwrites,
      topic: `Ticket #${ticket.number} • opener:${interaction.user.id} • panel:${panel.id}`,
    });
    ticket.channelId = channel.id;
    await store.update(ticket);
    await channel.send({ content: renderIntro(panel, ticket) });
    await interaction.editReply(`✅ Ticket opened: <#${channel.id}>`);
  } catch (err) {
    // Roll back so the reserved ticket doesn't count against maxOpenPerUser and lock the user out.
    await store.remove(ticket.id);
    await interaction.editReply('⚠️ Could not create the ticket channel — please try again or ping a mod.');
    console.error('ticket channel creation failed', err);
  }
}

async function handleCommand(interaction: ChatInputCommandInteraction, deps: TicketingDeps): Promise<void> {
  const { panel, store, commands } = deps;
  const command = interaction.commandName.replace('ticket-', '') as TicketCommand;

  if (!isCommandEnabled(commands, command)) {
    await interaction.reply({ content: `⚠️ /${interaction.commandName} is disabled.`, ephemeral: true });
    return;
  }
  const member = interaction.member as GuildMember | null;
  const roles = member?.roles?.cache?.map((r) => r.name) ?? [];
  if (!canManageTickets(roles, panel)) {
    await interaction.reply({ content: '⛔ Only ticket managers can run this.', ephemeral: true });
    return;
  }
  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.reply({ content: '⚠️ Run this inside a ticket channel.', ephemeral: true });
    return;
  }
  const ticket = await store.byChannel(channel.id);
  if (!ticket) {
    await interaction.reply({ content: '⚠️ This is not a ticket channel.', ephemeral: true });
    return;
  }
  const by = interaction.user.id;
  const text = channel as TextChannel;

  if (command === 'claim') {
    const r = claim(ticket, by);
    if (r.ok) await store.update(ticket);
    await interaction.reply(r.ok ? `🙋 Ticket claimed by <@${by}>.` : `⚠️ ${r.error}`);
  } else if (command === 'close') {
    const r = close(ticket, by);
    if (!r.ok) { await interaction.reply(`⚠️ ${r.error}`); return; }
    await store.update(ticket);
    await interaction.reply(`🔒 Ticket closed by <@${by}>.`);
    await postTranscript(interaction, deps, ticket);
    await moveTo(text, findCategoryId(interaction.guild, resolveCategories(panel, ticket.type).closed));
    await text.permissionOverwrites.edit(ticket.openerId, { SendMessages: false }).catch(() => {});
  } else if (command === 'reopen') {
    const r = reopen(ticket, by);
    if (!r.ok) { await interaction.reply(`⚠️ ${r.error}`); return; }
    await store.update(ticket);
    await interaction.reply(`🔓 Ticket reopened by <@${by}>.`);
    await moveTo(text, findCategoryId(interaction.guild, resolveCategories(panel, ticket.type).open));
    await text.permissionOverwrites.edit(ticket.openerId, { SendMessages: true }).catch(() => {});
  } else if (command === 'delete') {
    deleteTicket(ticket, by);
    await store.update(ticket);
    await interaction.reply(`🗑 Deleting ticket in 3s…`); // ack BEFORE the slow transcript work
    await postTranscript(interaction, deps, ticket);
    setTimeout(() => void text.delete().catch(() => {}), 3000);
  }
}

async function moveTo(channel: TextChannel, categoryId?: string): Promise<void> {
  if (categoryId) await channel.setParent(categoryId, { lockPermissions: false }).catch(() => {});
}

/** Build a transcript from the channel history and deliver it per the panel config. */
async function postTranscript(
  interaction: ChatInputCommandInteraction,
  deps: TicketingDeps,
  ticket: Ticket,
): Promise<void> {
  const { panel } = deps;
  if (!panel.transcript?.channel && !panel.transcript?.dmToOpener) return;
  const channel = interaction.channel as TextChannel;
  const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const msgs: TranscriptMessage[] = fetched
    ? [...fetched.values()].reverse().map((m) => ({ author: m.author.username, at: new Date(m.createdTimestamp).toISOString(), text: m.content }))
    : [];
  const file = { attachment: Buffer.from(renderTranscript(panel, ticket, msgs), 'utf8'), name: `${ticketChannelName(ticket)}.txt` };

  if (panel.transcript.channel) {
    const dest = interaction.guild?.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name.toLowerCase() === panel.transcript!.channel!.replace(/^#/, '').toLowerCase(),
    ) as TextChannel | undefined;
    await dest?.send({ files: [file] }).catch(() => {});
  }
  if (panel.transcript.dmToOpener) {
    const user = await interaction.client.users.fetch(ticket.openerId).catch(() => null);
    await user?.send({ files: [file] }).catch(() => {});
  }
}
