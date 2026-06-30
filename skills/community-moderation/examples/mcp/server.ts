/**
 * Foka AI — MCP server. Exposes the moderation logic as Model Context Protocol
 * tools so Claude / Cursor / any MCP client can call them directly (like Pegana).
 *
 * Install: npm i @modelcontextprotocol/sdk zod
 * Run:     npx tsx server.ts        # stdio transport
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { moderateMessage, TrustState } from '../moderate-message';
import { classifyMessage } from '../classify-and-route';
import { scanUrls } from '../normalize';
import { applyContentFilters, CONTENT_FILTERS, ContentFilter, ContentFilterConfig } from '../content-filters';
import { isImmune } from '../immunity';
import { buildReport, GroupEvent } from '../analytics';

const TRUST = z.enum(['NEW', 'MEMBER', 'TRUSTED', 'FLAGGED', 'MUTED', 'BANNED']);

const server = new McpServer({ name: 'foka-ai', version: '1.3.1' });

server.tool(
  'moderate_message',
  'Score a chat message for spam/scam and return an action decision (allow/warn/delete/mute; ban is human-gated).',
  {
    text: z.string(),
    memberTrust: TRUST.optional(),
    accountAgeDays: z.number().optional(),
    officialDomains: z.array(z.string()).optional(),
    blocklistDomains: z.array(z.string()).optional(),
    massPingTokens: z.array(z.string()).optional(),
  },
  async (args) => {
    const decision = moderateMessage({
      text: args.text,
      memberTrust: (args.memberTrust ?? 'NEW') as TrustState,
      accountAgeDays: args.accountAgeDays ?? 0,
      officialDomains: args.officialDomains,
      blocklistDomains: args.blocklistDomains,
      massPingTokens: args.massPingTokens,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(decision) }] };
  },
);

server.tool(
  'classify_message',
  'Classify a support message into a tag + priority (P1–P4).',
  { text: z.string() },
  async (args) => {
    const c = classifyMessage(args.text);
    return { content: [{ type: 'text' as const, text: JSON.stringify(c) }] };
  },
);

server.tool(
  'scan_urls',
  'Extract URLs/domains from text and flag suspicious ones (punycode, lookalike, brand-impersonation, blocklist).',
  {
    text: z.string(),
    officialDomains: z.array(z.string()).optional(),
    blocklist: z.array(z.string()).optional(),
  },
  async (args) => {
    const findings = scanUrls(args.text, args.officialDomains, args.blocklist);
    return { content: [{ type: 'text' as const, text: JSON.stringify(findings) }] };
  },
);

server.tool(
  'apply_content_filters',
  'Resolve the moderation action for a message from the content types it carries (links, stickers, gifs, forwards, mentions, …) and the configured content filters (Combot "Filters" parity). Returns the strictest action.',
  {
    present: z.array(z.enum(CONTENT_FILTERS)),
    config: z.record(z.any()).optional(),
    memberTrust: TRUST.optional(),
    newMemberNoLinks: z.boolean().optional(),
    newMemberNoMedia: z.boolean().optional(),
  },
  async (args) => {
    const decision = applyContentFilters(
      args.present as ContentFilter[],
      (args.config ?? {}) as ContentFilterConfig,
      { memberTrust: args.memberTrust as TrustState, newMemberNoLinks: args.newMemberNoLinks, newMemberNoMedia: args.newMemberNoMedia },
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(decision) }] };
  },
);

server.tool(
  'check_immunity',
  'Decide whether a subject is immune to moderation (MEE6 "Immunity Roles" parity): server owner, Administrator-permission roles, bots, and bot masters are immune by default; plus any configured immune role.',
  {
    id: z.string().optional(),
    roles: z.array(z.string()).optional(),
    isOwner: z.boolean().optional(),
    hasAdminPermission: z.boolean().optional(),
    isBot: z.boolean().optional(),
    config: z
      .object({
        roles: z.array(z.string()).optional(),
        botMasters: z.array(z.string()).optional(),
        immuneServerOwner: z.boolean().optional(),
        immuneAdminPermission: z.boolean().optional(),
        immuneBots: z.boolean().optional(),
      })
      .optional(),
  },
  async (args) => {
    const result = isImmune(
      { id: args.id, roles: args.roles, isOwner: args.isOwner, hasAdminPermission: args.hasAdminPermission, isBot: args.isBot },
      args.config ?? {},
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  },
);

server.tool(
  'build_analytics',
  'Compute a group analytics report (joins/leaves/messages/active users/avg DAU + day×hour activity heatmap) from an event log over a period, each metric compared to the immediately preceding equal-length window (Combot "Analytics" parity).',
  {
    events: z.array(
      z.object({
        type: z.enum(['join', 'leave', 'message']),
        memberId: z.string(),
        handle: z.string().optional(),
        displayName: z.string().optional(),
        at: z.string(),
      }),
    ),
    from: z.string(),
    to: z.string(),
    tzOffsetMinutes: z.number().optional(),
  },
  async (args) => {
    const report = buildReport(args.events as GroupEvent[], { from: args.from, to: args.to }, { tzOffsetMinutes: args.tzOffsetMinutes });
    return { content: [{ type: 'text' as const, text: JSON.stringify(report) }] };
  },
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
