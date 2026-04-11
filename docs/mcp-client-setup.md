# Connecting External Clients to CHAOS Agents via MCP

CHAOS agents can be accessed from any MCP-compatible client through the relay server's MCP endpoint. This guide covers setup for Claude Code, Cursor, and other MCP clients.

## Prerequisites

1. A running CHAOS relay server (self-hosted or the default at `https://chaos-relay.deno.dev`)
2. Your CHAOS API key (from the Chrome extension's Settings > Relay Server section)
3. At least one agent configured in the Chrome extension
4. The Chrome extension must be running and connected to the relay

## How It Works

```
External Client ──POST──> Relay Server ──WS──> Chrome Extension
 (Claude Code)          /mcp/:agentId          (Agent Loop)
                        <──JSON-RPC──<          <──Result──<
```

The relay exposes each CHAOS agent as an MCP server at `/mcp/{agentId}`. The relay forwards JSON-RPC requests to the Chrome extension over WebSocket, where the agent processes them with its full tool set.

## Available Tools

Each agent exposes these tools via MCP:

| Tool | Description |
|------|-------------|
| `chat` | Send a message to the agent — runs the full agentic loop |
| `delegate_task` | Assign a background task (runs asynchronously) |
| `read_memory` | Read a file from the agent's private storage |
| `write_memory` | Write to the agent's private storage |
| `list_files` | List files in the agent's storage |
| `get_status` | Get agent status, recent activity, pending tasks |
| `list_artifacts` | List shared artifacts from all agents |
| `read_artifact` | Read a shared artifact's content |

## Available Resources

| Resource URI | Description |
|---|---|
| `chaos://agent/{id}/activity` | Agent's recent activity log (JSON) |
| `chaos://agent/{id}/claudemd` | Agent's instructions/personality (Markdown) |

## Claude Code Setup

Add the MCP server to your Claude Code settings:

### Option A: Project Settings (`.claude/settings.json`)

```json
{
  "mcpServers": {
    "chaos-assistant": {
      "type": "url",
      "url": "https://your-relay.example.com/mcp/your-agent-id",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

### Option B: User Settings (`~/.claude/settings.json`)

Same format as above, but applies to all projects.

### Finding Your Agent ID

1. Open the CHAOS Chrome extension
2. Click on the agent in the sidebar
3. Go to Agent Settings
4. The Agent ID is shown at the top of the settings panel

### Finding Your API Key

1. Open the CHAOS Chrome extension
2. Go to Global Settings > Relay Server
3. Your API key is shown (or generated) in the connection section

### Usage

Once configured, Claude Code can use your CHAOS agents as tools:

```
> Use the chaos-assistant tool to search my bookmarks for AI papers

Claude Code will call the `chat` tool on your CHAOS agent, which will
use its bookmark_search tool to find relevant bookmarks.
```

## Cursor Setup

Add to your Cursor MCP settings (`.cursor/mcp.json` in your project or global settings):

```json
{
  "mcpServers": {
    "chaos-researcher": {
      "url": "https://your-relay.example.com/mcp/your-agent-id",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

## VS Code Setup (with MCP extension)

If using an MCP-compatible VS Code extension, add to your settings:

```json
{
  "mcp.servers": {
    "chaos-agent": {
      "transport": "streamable-http",
      "url": "https://your-relay.example.com/mcp/your-agent-id",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

## Generic MCP Client Setup

Any MCP client that supports Streamable HTTP transport can connect:

**Endpoint:** `POST https://your-relay.example.com/mcp/{agentId}`

**Headers:**
- `Authorization: Bearer {apiKey}` (required)
- `Content-Type: application/json`
- `Mcp-Session-Id: {sessionId}` (after initialization)

**Protocol Flow:**

1. Send `initialize` request, receive session ID in `Mcp-Session-Id` header
2. Send `notifications/initialized` notification
3. Use `tools/list` to discover available tools
4. Call tools with `tools/call`

Example with curl:

```bash
# Initialize
curl -X POST https://relay.example.com/mcp/my-agent \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'

# List tools (include Mcp-Session-Id from initialize response)
curl -X POST https://relay.example.com/mcp/my-agent \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# Call a tool
curl -X POST https://relay.example.com/mcp/my-agent \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"chat","arguments":{"message":"What tabs do I have open?"}}}'
```

## Troubleshooting

### "Agent is offline"
The Chrome extension is not running or not connected to the relay. Open Chrome, ensure the CHAOS extension is active, and check the relay connection in Settings.

### "Invalid or expired MCP session"
MCP sessions expire after 30 minutes of inactivity. Re-initialize by sending a new `initialize` request.

### "Unauthorized"
Check that your API key is correct and included in the `Authorization: Bearer` header.

### Slow responses
The `chat` tool runs a full agentic loop which may take 5-30 seconds depending on the task complexity and model speed. The `delegate_task` tool returns immediately (task runs in background).

### Rate limiting
MCP endpoints are rate-limited to 120 requests per minute per user. If you hit the limit, wait and retry.

## Security Notes

- API keys provide full access to the agent — treat them like passwords
- MCP sessions are scoped to a single agent — one session cannot access other agents
- All traffic should use HTTPS (TLS) in production
- The relay server never stores API keys in MCP session data
- Bot tokens and sensitive data remain encrypted in the relay's KV store
