# Foka AI — MCP server

Exposes the moderation logic as Model Context Protocol tools, so Claude/Cursor (or any MCP client) can call them directly — the same distribution model Pegana uses.

## Tools

| Tool | Input | Output |
|------|-------|--------|
| `moderate_message` | `text`, `memberTrust?`, `accountAgeDays?`, `officialDomains?`, `blocklistDomains?` | `Decision` (action, severity, score, reasons, escalate) |
| `classify_message` | `text` | `{ tag, priority }` |
| `scan_urls` | `text`, `officialDomains?`, `blocklist?` | `UrlFinding[]` |

## Run

```bash
npm i @modelcontextprotocol/sdk zod
npx tsx server.ts        # stdio transport
```

## Connect (Claude Desktop / Cursor)

```json
{
  "mcpServers": {
    "foka-ai": {
      "command": "npx",
      "args": ["tsx", "/abs/path/to/examples/mcp/server.ts"]
    }
  }
}
```

The tools are pure and stateless — wire bans/kicks to a human and persistence to your `MemberStore` in the calling agent.
