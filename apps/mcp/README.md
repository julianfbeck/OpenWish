# OpenWish MCP server

The stdio MCP server lets coding agents list projects, feature requests, bugs,
and card-data issues, and add private implementation notes.

```bash
cd apps/mcp
go build -o openwish-mcp .
```

Configure the MCP process with `OPENWISH_API_URL` and `OPENWISH_API_KEY`. The
key is the server's `OPENWISH_GLOBAL_API_KEY`; keep it in the MCP client's
secret/environment configuration rather than command arguments or source.

Example client configuration:

```json
{
  "mcpServers": {
    "openwish": {
      "command": "/absolute/path/to/apps/mcp/openwish-mcp",
      "env": {
        "OPENWISH_API_URL": "https://wishkit.example.com",
        "OPENWISH_API_KEY": "set-this-in-your-secret-store"
      }
    }
  }
}
```

The server supports the established initialize handshake and the stateless
`server/discover` request introduced by MCP 2026-07-28.
