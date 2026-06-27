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

const server = new McpServer({ name: 'foka-ai', version: '1.0.0' });

server.tool(
  'moderate_message',
  'Score a chat message for spam/scam and return an action decision (allow/warn/delete/mute; ban is human-gated).',
  {
    text: z.string(),
    memberTrust: z.enum(['NEW', 'MEMBER', 'TRUSTED', 'FLAGGED', 'MUTED', 'BANNED']).optional(),
    accountAgeDays: z.number().optional(),
    officialDomains: z.array(z.string()).optional(),
    blocklistDomains: z.array(z.string()).optional(),
  },
  async (args) => {
    const decision = moderateMessage({
      text: args.text,
      memberTrust: (args.memberTrust ?? 'NEW') as TrustState,
      accountAgeDays: args.accountAgeDays ?? 0,
      officialDomains: args.officialDomains,
      blocklistDomains: args.blocklistDomains,
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

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
