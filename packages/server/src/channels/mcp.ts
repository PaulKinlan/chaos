/**
 * MCP (Model Context Protocol) Server Handler
 *
 * Exposes CHAOS agents as MCP servers via Streamable HTTP transport.
 * External MCP clients (Claude Code, Cursor, etc.) connect to:
 *   POST /mcp/:agentId — JSON-RPC requests
 *   GET  /mcp/:agentId — SSE stream for server-initiated messages
 *   DELETE /mcp/:agentId — Session termination
 *
 * The relay forwards MCP requests to the Chrome extension via WebSocket,
 * waits for the response, and returns it to the external client.
 */

import { logger } from "../logger.ts";
import { getKv, isKvAvailable } from "../kv.ts";
import { getConnectionCount, pushToUser } from "../ws.ts";
import type { UserSession } from "../auth.ts";

// ── Types ──

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface McpSession {
  sessionId: string;
  userId: string;
  agentId: string;
  createdAt: string;
  lastActivityAt: string;
  serverCapabilities: McpServerCapabilities;
}

interface McpServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
}

// ── Constants ──

const MCP_PROTOCOL_VERSION = "2025-11-05";
const MCP_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MCP_REQUEST_TIMEOUT_MS = 30_000; // 30 seconds
const MCP_KV_PREFIX = "mcp_sessions";

// ── Pending Request Tracking ──
// correlationId -> { resolve, reject, timer }
const pendingRequests: Map<string, {
  resolve: (result: JsonRpcResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}> = new Map();

/**
 * Handle an MCP response coming back from the extension via WebSocket.
 * Called by the WebSocket message handler in main.ts.
 */
export function handleMcpResponse(
  correlationId: string,
  response: JsonRpcResponse,
): void {
  const pending = pendingRequests.get(correlationId);
  if (!pending) {
    logger.warn("mcp", "Received response for unknown correlation ID", {
      correlationId,
    });
    return;
  }
  clearTimeout(pending.timer);
  pendingRequests.delete(correlationId);
  pending.resolve(response);
  logger.debug("mcp", "Resolved pending MCP request", { correlationId });
}

/**
 * Forward a JSON-RPC request to the extension and wait for the response.
 */
async function forwardToExtension(
  userId: string,
  agentId: string,
  request: JsonRpcRequest,
): Promise<JsonRpcResponse> {
  // Check if extension is connected
  if (getConnectionCount(userId) === 0) {
    return {
      jsonrpc: "2.0",
      id: request.id,
      error: {
        code: -32000,
        message: "Agent is offline — the Chrome extension is not connected",
      },
    };
  }

  const correlationId = crypto.randomUUID();

  // Create a promise that resolves when the extension responds
  const responsePromise = new Promise<JsonRpcResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(correlationId);
      reject(new Error("MCP request timed out"));
    }, MCP_REQUEST_TIMEOUT_MS);

    pendingRequests.set(correlationId, { resolve, reject, timer });
  });

  // Send to extension via WebSocket
  pushToUser(userId, {
    type: "mcp-request",
    correlationId,
    agentId,
    jsonrpc: request,
  });

  logger.info("mcp", "Forwarded MCP request to extension", {
    userId,
    agentId,
    method: request.method,
    correlationId,
  });

  return responsePromise;
}

// ── Session Management ──

async function createMcpSession(
  userId: string,
  agentId: string,
): Promise<McpSession> {
  const session: McpSession = {
    sessionId: crypto.randomUUID(),
    userId,
    agentId,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    serverCapabilities: {
      tools: { listChanged: false },
      resources: { subscribe: false, listChanged: false },
      prompts: { listChanged: false },
    },
  };

  if (isKvAvailable() && getKv()) {
    const kv = getKv()!;
    await kv.set([MCP_KV_PREFIX, session.sessionId], session, {
      expireIn: MCP_SESSION_TTL_MS,
    });
  }

  logger.info("mcp", "Created MCP session", {
    sessionId: session.sessionId,
    userId,
    agentId,
  });

  return session;
}

async function getMcpSession(sessionId: string): Promise<McpSession | null> {
  if (!isKvAvailable() || !getKv()) return null;
  const kv = getKv()!;
  const entry = await kv.get<McpSession>([MCP_KV_PREFIX, sessionId]);
  return entry.value;
}

async function touchMcpSession(sessionId: string): Promise<void> {
  if (!isKvAvailable() || !getKv()) return;
  const kv = getKv()!;
  const entry = await kv.get<McpSession>([MCP_KV_PREFIX, sessionId]);
  if (entry.value) {
    entry.value.lastActivityAt = new Date().toISOString();
    await kv.set([MCP_KV_PREFIX, sessionId], entry.value, {
      expireIn: MCP_SESSION_TTL_MS,
    });
  }
}

async function deleteMcpSession(sessionId: string): Promise<void> {
  if (!isKvAvailable() || !getKv()) return;
  const kv = getKv()!;
  await kv.delete([MCP_KV_PREFIX, sessionId]);
  logger.info("mcp", "Deleted MCP session", { sessionId });
}

// ── Built-in Tool Definitions ──

function getBuiltInTools(agentId: string) {
  return [
    {
      name: "chat",
      description:
        `Send a message to agent ${agentId} and get a response. The agent processes the message using its full agentic loop with access to all its configured tools.`,
      inputSchema: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The message to send to the agent",
          },
        },
        required: ["message"],
      },
    },
    {
      name: "delegate_task",
      description:
        `Assign a background task to agent ${agentId}. The task runs asynchronously and results are stored in the agent's task board.`,
      inputSchema: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "Task description and instructions",
          },
          priority: {
            type: "string",
            enum: ["low", "normal", "high"],
            description: "Task priority",
          },
        },
        required: ["task"],
      },
    },
    {
      name: "read_memory",
      description: `Read a file from agent ${agentId}'s private storage.`,
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path relative to agent's storage root",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "write_memory",
      description:
        `Write content to a file in agent ${agentId}'s private storage.`,
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path relative to agent's storage root",
          },
          content: { type: "string", description: "File content to write" },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "list_files",
      description: `List files in agent ${agentId}'s private storage.`,
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Directory path (default: root)",
          },
        },
      },
    },
    {
      name: "get_status",
      description:
        `Get agent ${agentId}'s current status, recent activity, and pending tasks.`,
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "list_artifacts",
      description: "List shared artifacts published by agents.",
      inputSchema: {
        type: "object",
        properties: {
          agentId: {
            type: "string",
            description: "Filter by agent ID (optional)",
          },
        },
      },
    },
    {
      name: "read_artifact",
      description: "Read a shared artifact's content by path.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Artifact path" },
        },
        required: ["path"],
      },
    },
  ];
}

// ── Request Handlers ──

/**
 * Handle an MCP JSON-RPC request locally (initialize, tools/list)
 * or forward to the extension (tools/call, etc.).
 */
async function handleJsonRpcRequest(
  session: UserSession,
  agentId: string,
  mcpSessionId: string | null,
  request: JsonRpcRequest,
): Promise<{ response: JsonRpcResponse; mcpSession?: McpSession }> {
  const { method, params, id } = request;

  switch (method) {
    case "initialize": {
      const mcpSession = await createMcpSession(session.userId, agentId);
      return {
        response: {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: mcpSession.serverCapabilities,
            serverInfo: {
              name: `chaos-agent-${agentId}`,
              version: "0.1.0",
            },
          },
        },
        mcpSession,
      };
    }

    case "notifications/initialized":
      // Client acknowledges initialization — no response needed for notifications
      return { response: { jsonrpc: "2.0", id } };

    case "tools/list":
      return {
        response: {
          jsonrpc: "2.0",
          id,
          result: { tools: getBuiltInTools(agentId) },
        },
      };

    case "tools/call": {
      // Forward to extension
      const callParams = params as
        | { name: string; arguments?: unknown }
        | undefined;
      if (!callParams?.name) {
        return {
          response: {
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Missing tool name in params" },
          },
        };
      }

      try {
        const result = await forwardToExtension(
          session.userId,
          agentId,
          request,
        );
        return { response: { ...result, id } };
      } catch (err) {
        return {
          response: {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32000,
              message: err instanceof Error ? err.message : String(err),
            },
          },
        };
      }
    }

    case "resources/list":
      return {
        response: {
          jsonrpc: "2.0",
          id,
          result: {
            resources: [
              {
                uri: `chaos://agent/${agentId}/activity`,
                name: "Recent Activity",
                description: "Agent's recent activity log",
                mimeType: "application/json",
              },
              {
                uri: `chaos://agent/${agentId}/claudemd`,
                name: "Agent Instructions",
                description: "Agent's personality and instructions (CLAUDE.md)",
                mimeType: "text/markdown",
              },
            ],
          },
        },
      };

    case "resources/read": {
      // Forward to extension
      try {
        const result = await forwardToExtension(
          session.userId,
          agentId,
          request,
        );
        return { response: { ...result, id } };
      } catch (err) {
        return {
          response: {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32000,
              message: err instanceof Error ? err.message : String(err),
            },
          },
        };
      }
    }

    case "prompts/list":
      return {
        response: {
          jsonrpc: "2.0",
          id,
          result: {
            prompts: [
              {
                name: `chat_with_agent`,
                description: `Start a conversation with agent ${agentId}`,
                arguments: [
                  {
                    name: "message",
                    description: "Your message",
                    required: true,
                  },
                ],
              },
              {
                name: `delegate_to_agent`,
                description: `Assign a task to agent ${agentId}`,
                arguments: [
                  {
                    name: "task",
                    description: "Task instructions",
                    required: true,
                  },
                  {
                    name: "context",
                    description: "Additional context",
                    required: false,
                  },
                ],
              },
            ],
          },
        },
      };

    case "prompts/get": {
      // Forward to extension for dynamic prompt resolution
      try {
        const result = await forwardToExtension(
          session.userId,
          agentId,
          request,
        );
        return { response: { ...result, id } };
      } catch (err) {
        return {
          response: {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32000,
              message: err instanceof Error ? err.message : String(err),
            },
          },
        };
      }
    }

    case "ping":
      return { response: { jsonrpc: "2.0", id, result: {} } };

    default:
      return {
        response: {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        },
      };
  }
}

// ── HTTP Handlers ──

/**
 * Handle POST /mcp/:agentId — JSON-RPC request
 */
export async function handleMcpPost(
  agentId: string,
  req: Request,
  session: UserSession,
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mcpJsonResponse({
      jsonrpc: "2.0",
      error: { code: -32700, message: "Parse error — invalid JSON" },
    }, 400);
  }

  const mcpSessionId = req.headers.get("Mcp-Session-Id");

  // Validate MCP session if provided
  if (mcpSessionId) {
    const mcpSession = await getMcpSession(mcpSessionId);
    if (!mcpSession) {
      return mcpJsonResponse({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Invalid or expired MCP session" },
      }, 401);
    }
    if (
      mcpSession.agentId !== agentId || mcpSession.userId !== session.userId
    ) {
      return mcpJsonResponse({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Session/agent mismatch" },
      }, 403);
    }
    await touchMcpSession(mcpSessionId);
  }

  // Handle batch requests
  if (Array.isArray(body)) {
    const responses: JsonRpcResponse[] = [];
    let newMcpSessionId = mcpSessionId;
    for (const request of body as JsonRpcRequest[]) {
      const { response, mcpSession } = await handleJsonRpcRequest(
        session,
        agentId,
        newMcpSessionId,
        request,
      );
      if (mcpSession) newMcpSessionId = mcpSession.sessionId;
      // Don't include responses for notifications (no id)
      if (request.id !== undefined) responses.push(response);
    }
    return mcpJsonResponse(responses, 200, newMcpSessionId);
  }

  // Single request
  const request = body as JsonRpcRequest;
  const { response, mcpSession } = await handleJsonRpcRequest(
    session,
    agentId,
    mcpSessionId,
    request,
  );

  const newSessionId = mcpSession?.sessionId || mcpSessionId;

  // Notifications (no id) get 202 Accepted
  if (request.id === undefined) {
    return new Response(null, {
      status: 202,
      headers: newSessionId ? { "Mcp-Session-Id": newSessionId } : {},
    });
  }

  return mcpJsonResponse(response, 200, newSessionId);
}

/**
 * Handle GET /mcp/:agentId — SSE stream for server-initiated messages
 */
export function handleMcpGet(
  agentId: string,
  req: Request,
  session: UserSession,
): Response {
  const mcpSessionId = req.headers.get("Mcp-Session-Id");
  if (!mcpSessionId) {
    return mcpJsonResponse({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Mcp-Session-Id header required for GET",
      },
    }, 400);
  }

  // Open an SSE stream (currently no server-initiated messages, but keep the connection)
  const body = new ReadableStream({
    start(controller) {
      // Send a keepalive comment every 30 seconds
      const interval = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(": keepalive\n\n"));
        } catch {
          clearInterval(interval);
        }
      }, 30_000);

      // Log that SSE stream was opened
      logger.info("mcp", "SSE stream opened", {
        agentId,
        userId: session.userId,
        mcpSessionId,
      });

      // Clean up on abort
      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        logger.info("mcp", "SSE stream closed", { agentId, mcpSessionId });
      });
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Mcp-Session-Id": mcpSessionId,
    },
  });
}

/**
 * Handle DELETE /mcp/:agentId — Session termination
 */
export async function handleMcpDelete(
  agentId: string,
  req: Request,
  session: UserSession,
): Promise<Response> {
  const mcpSessionId = req.headers.get("Mcp-Session-Id");
  if (mcpSessionId) {
    await deleteMcpSession(mcpSessionId);
  }
  logger.info("mcp", "MCP session terminated", {
    agentId,
    userId: session.userId,
    mcpSessionId,
  });
  return new Response(null, { status: 204 });
}

// ── Helpers ──

function mcpJsonResponse(
  data: unknown,
  status = 200,
  mcpSessionId?: string | null,
): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (mcpSessionId) {
    headers["Mcp-Session-Id"] = mcpSessionId;
  }
  return new Response(JSON.stringify(data), { status, headers });
}
