# Plan: MCP Integration

## Status (audited 2026-04-11)

### Phase 1: MCP Client — Streamable HTTP transport — DONE
- [x] MCP client module (`src/mcp/client.ts`) with Streamable HTTP transport
- [x] JSON-RPC 2.0 message encoding/decoding (inline in client.ts)
- [x] Session management (Mcp-Session-Id lifecycle)
- [x] Connection state machine (disconnected / connecting / ready / error)
- [x] Tool discovery (`tools/list`) and dynamic registration
- [x] Resource discovery (`resources/list`) and read support
- [x] Prompt template discovery (`prompts/list`) and retrieval
- [x] SSE response parsing for streaming responses
- [x] Bearer auth support
- [x] 34 unit tests (`src/mcp/__tests__/client.test.ts`)

### Phase 2: MCP Client — Configuration & UI — DONE
- [x] Global MCP server config in `chrome.storage.local` (`src/mcp/config.ts`)
- [x] Background message handlers for getMcpServers, addMcpServer, removeMcpServer, updateMcpServer, testMcpServer
- [x] Settings UI for adding/removing/testing global MCP servers (section in `global-settings-view.ts`)
- [x] MCP signal in app-state.ts (`mcpServers`, `refreshMcpServers()`)
- [ ] Per-agent MCP server config in `AgentMeta` (deferred — global config covers most use cases)
- [ ] Agent settings UI for per-agent MCP server overrides (deferred)
- [ ] Connection status indicators in sidebar (deferred)

### Phase 3: MCP Client — Agentic loop integration — DONE
- [x] Dynamic tool injection from connected MCP servers into the tool set (`extension-agent.ts`)
- [x] MCP tool execution bridge (`src/mcp/tool-bridge.ts` — uses AI SDK `jsonSchema()` + `tool()`)
- [x] Tool namespacing to avoid collisions (e.g. `mcp_github_create_issue`)
- [x] Tests for tool bridge (`src/mcp/__tests__/tool-bridge.test.ts` — 8 tests)
- [ ] MCP resource injection as context (agent can read MCP resources) (deferred)
- [ ] MCP prompt templates surfaced in agent UI (deferred)
- [ ] Deferred/lazy tool loading (only fetch tool schemas on first use) (deferred)

### Phase 4: MCP Server — Expose agents via relay — DONE
- [x] MCP server endpoint on the relay (`/mcp/:agentId`) — Streamable HTTP
- [x] JSON-RPC request handler (`src/channels/mcp.ts`) with initialize, tools/list, tools/call, resources/list, resources/read, prompts/list, prompts/get, ping
- [x] JSON-RPC request forwarding: relay -> extension via WebSocket (correlation-based)
- [x] Built-in tool definitions: chat, delegate_task, read_memory, write_memory, list_files, get_status, list_artifacts, read_artifact
- [x] Resource definitions: agent activity log, CLAUDE.md instructions
- [x] Prompt templates: chat_with_agent, delegate_to_agent
- [x] MCP session management in Deno KV (30-min TTL, create/touch/delete)
- [x] Authentication: reuses existing Bearer token validation
- [x] Rate limiting: 120 requests/min per user on MCP endpoints
- [x] Extension-side handler: processes inbound MCP requests, runs agent loop, returns results
- [x] Batch JSON-RPC request support
- [x] SSE stream endpoint (GET /mcp/:agentId) with keepalive
- [x] Session termination (DELETE /mcp/:agentId)
- [x] 13 unit tests (`src/__tests__/mcp.test.ts`)

### Phase 5: MCP Server — External client support — TODO
- [ ] Claude Code configuration instructions (`.claude/settings.json` MCP block)
- [ ] Cursor / VS Code MCP client configuration docs
- [x] Agent discovery endpoint (`/mcp/agents`) — basic implementation
- [x] Rate limiting on MCP server endpoints (120/min per user)
- [ ] Audit logging of external MCP tool calls

---

## Problem

CHAOS agents currently operate with a fixed set of built-in tools (Chrome APIs, web scraping, WASM, file I/O, communication, hooks, skills). There is no standard way to:

1. **Connect agents to external tool servers** — A user running a GitHub MCP server, a database MCP server, or a Jira MCP server cannot make those tools available to CHAOS agents.

2. **Expose CHAOS agents to external AI tools** — Claude Code, Cursor, and other MCP-aware clients cannot interact with CHAOS agents. The extension is an isolated island.

MCP (Model Context Protocol) is the emerging standard for this. It defines a JSON-RPC 2.0 protocol for LLM applications to discover and invoke tools, read resources, and use prompt templates from external servers. Adopted by Anthropic, OpenAI, Google, Microsoft, and others. The spec is governed by the Agentic AI Foundation under the Linux Foundation.

CHAOS should be both an **MCP client** (connecting to external MCP servers for additional tools) and an **MCP server** (exposing agents as tools to external clients).

## Background: What is MCP?

### Protocol

MCP uses JSON-RPC 2.0 over a transport layer. Three core primitives:

- **Tools** — Callable functions with JSON Schema parameters and typed results. Discovery via `tools/list`, invocation via `tools/call`.
- **Resources** — Readable data (files, DB records, API responses). Discovery via `resources/list`, retrieval via `resources/read`.
- **Prompts** — Reusable prompt templates with parameters. Discovery via `prompts/list`, retrieval via `prompts/get`.

### Lifecycle

```
Client                          Server
  |                               |
  |-- initialize ----------------->|
  |<-- InitializeResult ----------|  (capabilities, protocol version)
  |-- initialized notification -->|
  |                               |
  |-- tools/list ---------------->|
  |<-- tools[] -------------------|
  |                               |
  |-- tools/call ---------------->|
  |<-- result --------------------|
  |                               |
  |-- DELETE (session end) ------>|
```

### Transport: Streamable HTTP

The current spec (2025-11-25) defines two transports:

1. **stdio** — Client spawns server as subprocess, communicates via stdin/stdout. **Not available in Chrome extensions** (no child processes in service workers).

2. **Streamable HTTP** — Server exposes a single HTTP endpoint. Client sends JSON-RPC via POST, receives responses as `application/json` or `text/event-stream` (SSE). Client can open a GET SSE stream for server-initiated messages. Session management via `Mcp-Session-Id` header.

**For CHAOS, Streamable HTTP is the only viable transport.** Chrome extension service workers can make HTTP requests (`fetch`) and handle SSE streams, but cannot spawn subprocesses.

### TypeScript SDK

The official `@modelcontextprotocol/sdk` package provides:
- `Client` class with `listTools()`, `callTool()`, `listResources()`, `readResource()`, `listPrompts()`, `getPrompt()`
- `StreamableHTTPClientTransport` for HTTP connections
- `Server` class for building MCP servers

However, the SDK has Node.js dependencies (streams, process). We will likely need a **lightweight custom implementation** of the Streamable HTTP client that works in a service worker context, or a bundled/patched version of the SDK.

---

## Part 1: MCP Client — Connecting to External MCP Servers

### Architecture

```
+-------------------------------------------------------------------+
|  Chrome Extension (Service Worker)                                |
|                                                                   |
|  +------------------+     +------------------+                    |
|  | Agentic Loop     |     | MCP Client       |                   |
|  |                  |     | Manager           |                   |
|  | Built-in tools:  |     |                   |                   |
|  |  - chrome.*      |     | +-- Connection 1 -+--> MCP Server A  |
|  |  - web scraping  |     | |   (GitHub)      |    (remote)      |
|  |  - file I/O      |     | |                 |                   |
|  |  - skills        |     | +-- Connection 2 -+--> MCP Server B  |
|  |  - hooks         |     | |   (Database)    |    (local)       |
|  |  - wasm          |     | |                 |                   |
|  |                  |     | +-- Connection N -+--> MCP Server N  |
|  | MCP tools:       |     |                   |                   |
|  |  - mcp_github_*  |     +------------------+                    |
|  |  - mcp_db_*      |                                             |
|  |  - mcp_jira_*    |                                             |
|  +------------------+                                             |
+-------------------------------------------------------------------+
```

### MCP Server Configuration

Two levels of configuration:

#### Global MCP Servers

Stored in `chrome.storage.sync` alongside other settings. Available to ALL agents.

```typescript
interface McpServerConfig {
  id: string;                    // unique identifier (kebab-case)
  name: string;                  // human-readable name
  url: string;                   // Streamable HTTP endpoint URL
  enabled: boolean;              // toggle without removing
  auth?: {
    type: 'bearer' | 'header' | 'query';
    token?: string;              // for bearer
    headerName?: string;         // for custom header
    headerValue?: string;
    queryParam?: string;         // for query-string auth
    queryValue?: string;
  };
  timeout?: number;              // request timeout in ms (default 30000)
  retries?: number;              // max retries on failure (default 2)
}

interface McpSettings {
  globalServers: McpServerConfig[];
}
```

#### Per-Agent MCP Servers

Stored in `AgentMeta.mcpServers`. Only available to that specific agent.

```typescript
interface AgentMeta {
  // ... existing fields ...
  mcpServers?: McpServerConfig[];  // per-agent MCP servers
  mcpDisabledGlobal?: string[];    // IDs of global servers to disable for this agent
}
```

Resolution order when building an agent's MCP tool set:
1. Start with global servers (where `enabled: true`)
2. Remove any in `mcpDisabledGlobal`
3. Add per-agent servers
4. Connect to all, discover tools, namespace them

### MCP Client Module

A lightweight MCP client that works in Chrome extension service workers.

```
src/mcp/
  client.ts           — McpClient class (one instance per server connection)
  manager.ts          — McpClientManager (manages all connections, tool aggregation)
  transport.ts        — Streamable HTTP transport (fetch-based, SSE support)
  jsonrpc.ts          — JSON-RPC 2.0 message encoding/decoding
  types.ts            — MCP protocol types (Tool, Resource, Prompt, etc.)
  tools-bridge.ts     — Converts MCP tools to Vercel AI SDK ToolSet format
```

#### Transport Layer (`transport.ts`)

```typescript
class StreamableHttpTransport {
  private endpoint: string;
  private sessionId: string | null = null;
  private auth: McpServerConfig['auth'];

  // Send a JSON-RPC request, return the response
  async request(method: string, params?: unknown): Promise<JsonRpcResponse>;

  // Open an SSE stream for server-initiated messages (GET)
  async openStream(onMessage: (msg: JsonRpcMessage) => void): Promise<void>;

  // Close the session (DELETE)
  async close(): Promise<void>;
}
```

Key considerations for service workers:
- **No persistent connections.** Service workers can be suspended. The SSE stream opened via GET will break. We must handle reconnection gracefully using `Last-Event-ID`.
- **Session resumption.** Store `Mcp-Session-Id` in memory (lost on SW restart) or in `chrome.storage.session` (survives SW restart within browser session). On reconnect, re-send the session ID.
- **Timeouts.** Service workers have a 5-minute execution limit. Long-running MCP calls must complete within this window. Use `AbortSignal` with timeout.

#### Client Class (`client.ts`)

```typescript
class McpClient {
  private transport: StreamableHttpTransport;
  private capabilities: ServerCapabilities | null = null;
  private tools: McpTool[] = [];
  private resources: McpResource[] = [];
  private prompts: McpPrompt[] = [];

  async connect(): Promise<void>;         // initialize handshake
  async disconnect(): Promise<void>;      // clean session close
  async listTools(): Promise<McpTool[]>;
  async callTool(name: string, args: unknown): Promise<McpToolResult>;
  async listResources(): Promise<McpResource[]>;
  async readResource(uri: string): Promise<McpResourceContent>;
  async listPrompts(): Promise<McpPrompt[]>;
  async getPrompt(name: string, args?: Record<string, string>): Promise<McpPromptResult>;
}
```

#### Manager Class (`manager.ts`)

```typescript
class McpClientManager {
  private clients: Map<string, McpClient> = new Map();

  // Connect to all configured servers for an agent
  async connectForAgent(agentId: string): Promise<void>;

  // Disconnect all
  async disconnectAll(): Promise<void>;

  // Get aggregated tools as Vercel AI SDK ToolSet
  async getToolSet(agentId: string): Promise<ToolSet>;

  // Get all available resources across connected servers
  async getResources(agentId: string): Promise<McpResource[]>;
}
```

### Tool Namespacing

MCP tools from different servers may collide (e.g. two servers both expose `search`). We namespace tools:

```
{server_id}_{tool_name}
```

Examples:
- `github_create_issue`
- `github_list_repos`
- `postgres_query`
- `jira_create_ticket`

The server ID comes from `McpServerConfig.id` (user-configured, kebab-case). Underscores in the prefix ensure it is a valid tool name for the AI SDK.

### Tools Bridge (`tools-bridge.ts`)

Converts MCP tool definitions to Vercel AI SDK `tool()` objects:

```typescript
function mcpToolToAiSdkTool(
  serverId: string,
  mcpTool: McpTool,
  client: McpClient,
): [string, AiSdkTool] {
  const name = `${serverId}_${mcpTool.name}`;
  return [name, tool({
    description: mcpTool.description,
    inputSchema: convertJsonSchemaToZod(mcpTool.inputSchema),
    execute: async (args) => {
      const result = await client.callTool(mcpTool.name, args);
      return result.content;  // MCP returns { content: [...] }
    },
  })];
}
```

The JSON Schema to Zod conversion is non-trivial. Options:
1. Use `zod-to-json-schema` in reverse (there are libraries for this)
2. Pass JSON Schema directly if the AI SDK supports it (Vercel AI SDK does support raw JSON Schema via `jsonSchema()`)
3. Use `jsonSchema()` from `ai` package — **this is the simplest path**

### Agentic Loop Integration

In `agentic-loop.ts`, the tool collection currently looks like:

```typescript
const allTools = {
  ...agentTools,
  ...chromeTools,
  ...webTools,
  ...wasmTools,
  ...hookTools,
  ...masterTools,
  ...skillTools,
  ...communicationTools,
};
```

We add MCP tools:

```typescript
const mcpTools = await mcpClientManager.getToolSet(agentId);
const allTools = {
  ...agentTools,
  ...chromeTools,
  ...webTools,
  ...wasmTools,
  ...hookTools,
  ...masterTools,
  ...skillTools,
  ...communicationTools,
  ...mcpTools,  // dynamically discovered from connected MCP servers
};
```

#### Lazy Loading (Phase 3 optimization)

With many MCP servers connected, the tool set could be huge (100+ tools). This bloats the system prompt and wastes tokens. Following Claude Code's approach with Tool Search:

1. On connection, fetch tool names and descriptions only (not full schemas)
2. Include a meta-tool `mcp_search_tools` that lets the agent search available MCP tools by keyword
3. When the agent selects a tool, fetch its full schema on demand
4. Cache schemas for the session

### Connection Management

```
State Machine:

  DISCONNECTED
       |
       | connect()
       v
  CONNECTING -----(timeout/error)----> ERROR
       |                                  |
       | initialize OK                    | retry()
       v                                  |
     READY <------------------------------+
       |
       | disconnect() / server gone
       v
  DISCONNECTED
```

- **Connect on demand:** Don't connect to all MCP servers at startup. Connect when an agent starts a task that needs tools from a server. Cache the connection.
- **Handle SW suspension:** Store session IDs in `chrome.storage.session`. On SW wake, reconnect using stored session ID.
- **Heartbeat:** Periodically issue a lightweight request (e.g. `ping` or `tools/list`) to keep the connection warm and detect stale sessions.
- **Backoff:** Exponential backoff on reconnection (same pattern as `ws-client.ts`).

---

## Part 2: MCP Server — Exposing CHAOS Agents

### Architecture

External MCP clients (Claude Code, Cursor, etc.) connect to the relay server, which acts as a Streamable HTTP MCP server. The relay forwards JSON-RPC requests to the Chrome extension over the existing WebSocket/polling channel.

```
+----------------+       +------------------+       +-------------------+
| Claude Code    |       | CHAOS Relay      |       | Chrome Extension  |
| (MCP Client)   |       | Server           |       |                   |
|                |       |                  |       |                   |
| tools/list --->|--POST-->| /mcp/:agentId   |--WS-->| Handle MCP req    |
|                |       |                  |       |                   |
|                |<--JSON--|<-- MCP response  |<-WS--|<-- Tool results   |
|                |       |                  |       |                   |
| tools/call --->|--POST-->| Forward to ext  |--WS-->| Execute tool      |
|                |       |                  |       | Return result     |
|                |<--SSE---|<-- Stream result |<-WS--|<--                |
+----------------+       +------------------+       +-------------------+
```

### What to Expose

Each CHAOS agent appears as an MCP server with:

#### Tools

| MCP Tool Name | Description | Maps to |
|---|---|---|
| `chat` | Send a message to the agent and get a response | Agentic loop execution |
| `delegate_task` | Assign a task for background execution | Task system |
| `read_memory` | Read a file from the agent's private storage | `opfs.readFile` |
| `write_memory` | Write to the agent's private storage | `opfs.writeFile` |
| `list_files` | List files in agent storage | `opfs.listDir` |
| `get_status` | Get agent status and recent activity | Activity log |
| `list_artifacts` | List shared artifacts | Shared workspace |
| `read_artifact` | Read a shared artifact | Shared workspace |

#### Resources

| MCP Resource URI | Description |
|---|---|
| `chaos://agent/{id}/memory/{path}` | Agent's private files |
| `chaos://agent/{id}/artifacts` | Agent's shared artifacts |
| `chaos://agent/{id}/activity` | Recent activity log |
| `chaos://agent/{id}/claudemd` | Agent's CLAUDE.md (personality/instructions) |

#### Prompts

| MCP Prompt Name | Description |
|---|---|
| `chat_with_{agent_name}` | Start a conversation with the agent |
| `delegate_to_{agent_name}` | Delegate a task with context |

Plus any prompts from the agent's installed skills.

### Relay Server MCP Endpoint

New routes on the Deno relay server:

```
POST /mcp/:agentId          — Streamable HTTP MCP endpoint (JSON-RPC requests)
GET  /mcp/:agentId          — SSE stream for server-initiated messages
DELETE /mcp/:agentId        — Session termination
GET  /mcp/agents            — Discovery: list available agents (not MCP protocol, convenience)
```

#### Request Flow (tools/call example)

1. Claude Code sends `POST /mcp/agent-123` with JSON-RPC `tools/call` body
2. Relay authenticates the request (API key or ECDSA signature)
3. Relay creates a pending-request entry in KV with a unique correlation ID
4. Relay pushes the request to the extension via WebSocket (or stores for polling)
5. Extension receives the MCP request, executes the tool, sends the result back
6. Relay receives the result, correlates by ID, sends JSON-RPC response to Claude Code

#### Session Management

The relay server manages MCP sessions:
- On `initialize`, create a session in KV, return `Mcp-Session-Id`
- On subsequent requests, validate the session ID
- On `DELETE`, clean up the session
- Sessions expire after 30 minutes of inactivity

#### Authentication

Reuse existing CHAOS authentication:

1. **API Key** — The external MCP client includes `Authorization: Bearer {apiKey}` header. The relay validates against the user's stored API key. Simple, works with all MCP clients.

2. **ECDSA Signing** — For higher security, the external client can sign requests with the user's ECDSA key pair. This is more complex and not natively supported by MCP clients, so API key is the primary method.

3. **OAuth 2.1** — The MCP spec (2025-11-25) defines an OAuth-based auth flow. This is the standards-compliant approach for production. Consider implementing in a later phase if there is demand for multi-user access.

### Extension-Side MCP Request Handler

New module in the extension to handle inbound MCP requests from the relay:

```
src/mcp/
  server-handler.ts    — Processes inbound MCP JSON-RPC requests
  tool-definitions.ts  — Generates MCP tool definitions from agent capabilities
  resource-handler.ts  — Handles resource read requests
```

The handler receives MCP requests over the existing WebSocket channel (same infrastructure as channel messages). New message type:

```typescript
interface McpRelayMessage {
  type: 'mcp-request';
  correlationId: string;
  agentId: string;
  jsonrpc: JsonRpcRequest;
}

interface McpRelayResponse {
  type: 'mcp-response';
  correlationId: string;
  jsonrpc: JsonRpcResponse;
}
```

---

## Part 3: Implementation Phases

### Phase 1: MCP Client Core (2-3 weeks)

**Goal:** A CHAOS agent can connect to a single MCP server and use its tools.

**Deliverables:**
1. `src/mcp/jsonrpc.ts` — JSON-RPC 2.0 encode/decode
2. `src/mcp/transport.ts` — Streamable HTTP transport (fetch + SSE)
3. `src/mcp/client.ts` — McpClient with initialize, tools/list, tools/call
4. `src/mcp/types.ts` — MCP protocol types
5. `src/mcp/tools-bridge.ts` — Convert MCP tools to AI SDK ToolSet
6. Integration test against a real MCP server (e.g. `@modelcontextprotocol/server-everything`)

**Validation:**
- Connect to a local MCP server running Streamable HTTP
- List its tools, call a tool, get a result
- Tools appear in the agent's agentic loop and can be invoked

### Phase 2: Configuration & Multi-Server (1-2 weeks)

**Goal:** Users can configure multiple MCP servers (global + per-agent) via the UI.

**Deliverables:**
1. `McpServerConfig` type in `storage/types.ts`
2. `chrome.storage` read/write for MCP server configs
3. `src/mcp/manager.ts` — McpClientManager for multi-server orchestration
4. Settings UI: "MCP Servers" section with add/remove/test
5. Agent settings: per-agent MCP server overrides
6. Connection status display in sidebar

**Validation:**
- Configure two MCP servers in settings
- Disable one globally, enable it for a specific agent
- Both servers' tools appear in the correct agent's tool set

### Phase 3: Full MCP Client Features (1-2 weeks)

**Goal:** Complete MCP client with resources, prompts, and lazy loading.

**Deliverables:**
1. Resource discovery and read in McpClient
2. Prompt template discovery and retrieval
3. Lazy tool loading with `mcp_search_tools` meta-tool
4. Reconnection handling for service worker suspension
5. Session persistence in `chrome.storage.session`

**Validation:**
- Agent can read resources from an MCP server
- Agent can use prompt templates
- Tool schemas are loaded on demand, not all at startup
- Connection survives a service worker restart

### Phase 4: MCP Server via Relay (2-3 weeks)

**Goal:** External MCP clients can connect to CHAOS agents.

**Deliverables:**
1. Relay server: `/mcp/:agentId` endpoint with Streamable HTTP
2. Relay: MCP session management in KV
3. Relay: Request forwarding to extension via WebSocket
4. Extension: `src/mcp/server-handler.ts` processes inbound MCP requests
5. Extension: `src/mcp/tool-definitions.ts` generates tool schemas from agent capabilities
6. Authentication: API key verification on MCP endpoint

**Validation:**
- Claude Code connects to `https://relay.chaos.example/mcp/agent-123`
- Claude Code lists tools, sees `chat`, `delegate_task`, etc.
- Claude Code calls `chat` tool, message flows through relay to extension, response returns
- Claude Code reads a resource from the agent

### Phase 5: Polish & Documentation (1 week)

**Goal:** Production-ready MCP integration with docs and discovery.

**Deliverables:**
1. Agent discovery endpoint (`/mcp/agents`)
2. Rate limiting on MCP server endpoints
3. Audit logging for all external MCP interactions
4. Configuration docs for Claude Code, Cursor, VS Code
5. Resource handler for agent artifacts and activity log
6. Error handling and user-friendly error messages in UI

---

## Open Questions

### MCP Client

1. **SDK vs custom implementation?** The official `@modelcontextprotocol/sdk` TypeScript SDK has Node.js dependencies. Options:
   - Fork and patch for service worker compatibility
   - Write a minimal custom client (JSON-RPC over fetch is straightforward)
   - Use the SDK in the offscreen document (has DOM but not Node.js APIs)
   - **Recommendation:** Start with a minimal custom client. The protocol is simple enough. Revisit if complexity grows.

2. **Tool count explosion?** If a user connects 5 MCP servers with 20 tools each, that is 100 tools in the system prompt. Token cost is significant.
   - Lazy loading (Phase 3) mitigates this
   - Could also use provider-specific tool search (like Claude's built-in tool search)
   - Set a configurable max tools per server

3. **Auth token storage?** MCP server auth tokens (API keys, OAuth tokens) are sensitive.
   - Store in `chrome.storage.local` (encrypted at rest by Chrome, never synced)
   - Never include in `chrome.storage.sync` (synced to Google account)
   - Consider using `chrome.storage.session` for ephemeral tokens

4. **What about MCP servers that require OAuth?** The MCP spec defines an OAuth 2.1 flow (RFC 9126 + PKCE). Chrome extensions can do OAuth via `chrome.identity.launchWebAuthFlow`. Worth supporting but complex. Defer to a later phase.

### MCP Server

5. **Latency.** The relay adds a hop: Claude Code -> relay -> WS -> extension -> tool execution -> WS -> relay -> Claude Code. This could be 1-5 seconds per tool call. Is this acceptable?
   - For `chat` and `delegate_task`: yes, these are inherently slow
   - For `read_memory` and `list_files`: might feel sluggish
   - Consider caching frequently-read resources on the relay

6. **Extension offline.** If the Chrome extension is not running (browser closed, SW suspended), the MCP server cannot serve requests.
   - Return MCP error with clear message: "Agent is offline"
   - Consider queuing requests and executing when extension reconnects (complex, probably not worth it initially)

7. **Multi-user.** The current relay is single-user (one API key per session). MCP server access would be tied to the same user. Multi-user MCP access (e.g. sharing an agent with a team) is out of scope for now.

8. **Which agents to expose?** Not all agents should be MCP-accessible.
   - Add `mcpExposed: boolean` to `AgentMeta`
   - Default to `false` — user must explicitly enable
   - Master agent should probably not be exposed (too powerful)

---

## Security Considerations

### MCP Client (connecting to external servers)

1. **Prompt injection via tool results.** An MCP server could return tool results containing instructions that manipulate the agent. Mitigations:
   - Sanitize tool results (strip known injection patterns)
   - Clearly delimit tool results in the prompt (the AI SDK already does this)
   - User review of tool results for sensitive operations (already handled by permission system)

2. **Data exfiltration.** A malicious MCP server could provide tools that trick the agent into sending sensitive data. Mitigations:
   - Tool permission system applies to MCP tools (same as built-in tools)
   - Warn users when an MCP tool requests access to sensitive APIs
   - Network isolation: MCP tools cannot access chrome.* APIs directly

3. **Server impersonation.** Enforce HTTPS for all non-localhost MCP servers (same as relay client). Validate TLS certificates.

4. **Token leakage.** MCP auth tokens must not appear in:
   - Agent conversation logs
   - Activity logs
   - Error messages shown to users
   - Tool call arguments visible to the AI model

### MCP Server (exposing agents to external clients)

5. **Unauthorized access.** The MCP endpoint must require authentication on every request.
   - API key validation (existing infrastructure)
   - Rate limiting per client (existing `rate-limit.ts`)
   - Session-based access (MCP sessions expire)

6. **Resource access control.** External clients should not be able to read arbitrary agent files.
   - Whitelist accessible resource paths
   - Never expose other users' data
   - Never expose API keys or tokens via MCP resources

7. **Denial of service.** External clients could flood the MCP endpoint.
   - Rate limit per IP and per API key
   - Max concurrent MCP sessions per user
   - Request timeout (30 seconds default)

8. **Cross-agent access.** An external client connected to Agent A should not be able to access Agent B's data unless explicitly permitted.
   - MCP sessions are scoped to a single agent
   - Validate agent ID on every request

---

## Dependencies

- **Vercel AI SDK** — Already used for the agentic loop. The `jsonSchema()` helper supports raw JSON Schema (avoids Zod conversion for MCP tool schemas).
- **Relay server** — Already exists with WebSocket and KV infrastructure. New endpoints needed.
- **Chrome extension APIs** — `chrome.storage.session` for MCP session persistence. `fetch` for HTTP transport. No new permissions needed.
- **No new npm packages required** for Phase 1. The protocol is simple enough to implement directly.

## Related Plans

- [Skills Import](skills-import.md) — Skills and MCP are complementary. Skills inject instructions; MCP injects tools. An MCP server could provide both.
- [External Channels](external-channels.md) — The relay server infrastructure is shared. MCP server endpoints sit alongside channel endpoints.
- [Jobs Board](jobs-board.md) — External MCP clients could submit tasks to agents via the `delegate_task` tool, which feeds into the jobs/task system.
