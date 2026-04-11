// MCP Server Handler unit tests
// Tests the JSON-RPC handling, session management, and response correlation

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleMcpPost, handleMcpResponse } from "../channels/mcp.ts";
import type { UserSession } from "../auth.ts";

// ── Helpers ──

function createMockSession(): UserSession {
  return {
    userId: "test-user-123",
    apiKey: "test-api-key-123",
    createdAt: new Date().toISOString(),
    channels: [],
  };
}

function createJsonRpcRequest(
  method: string,
  params?: unknown,
  id?: string | number,
) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: id ?? 1,
    method,
    params,
  });
}

function createRequest(
  body: string,
  headers: Record<string, string> = {},
): Request {
  return new Request("https://relay.example.com/mcp/agent-123", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body,
  });
}

// ── Tests ──

Deno.test("MCP handler tests", async (t) => {
  const session = createMockSession();

  await t.step(
    "initialize returns protocol version and capabilities",
    async () => {
      const req = createRequest(createJsonRpcRequest("initialize", {
        protocolVersion: "2025-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      }));

      const resp = await handleMcpPost("agent-123", req, session);
      assertEquals(resp.status, 200);

      const body = await resp.json();
      assertEquals(body.jsonrpc, "2.0");
      assertEquals(body.id, 1);
      assertExists(body.result);
      assertEquals(body.result.protocolVersion, "2025-11-05");
      assertExists(body.result.capabilities);
      assertExists(body.result.serverInfo);
      assertEquals(body.result.serverInfo.name, "chaos-agent-agent-123");

      // Should return Mcp-Session-Id header
      const mcpSessionId = resp.headers.get("Mcp-Session-Id");
      assertExists(mcpSessionId);
    },
  );

  await t.step("tools/list returns built-in tools", async () => {
    const req = createRequest(createJsonRpcRequest("tools/list"));

    const resp = await handleMcpPost("agent-123", req, session);
    assertEquals(resp.status, 200);

    const body = await resp.json();
    assertEquals(body.jsonrpc, "2.0");
    assertExists(body.result);
    assertExists(body.result.tools);

    const toolNames = body.result.tools.map((t: { name: string }) => t.name);
    assertEquals(toolNames.includes("chat"), true);
    assertEquals(toolNames.includes("delegate_task"), true);
    assertEquals(toolNames.includes("read_memory"), true);
    assertEquals(toolNames.includes("write_memory"), true);
    assertEquals(toolNames.includes("list_files"), true);
    assertEquals(toolNames.includes("get_status"), true);
    assertEquals(toolNames.includes("list_artifacts"), true);
    assertEquals(toolNames.includes("read_artifact"), true);
  });

  await t.step("tools/list returns tools with valid JSON Schema", async () => {
    const req = createRequest(createJsonRpcRequest("tools/list"));
    const resp = await handleMcpPost("agent-123", req, session);
    const body = await resp.json();

    for (const tool of body.result.tools) {
      assertExists(tool.name);
      assertExists(tool.description);
      assertExists(tool.inputSchema);
      assertEquals(tool.inputSchema.type, "object");
    }
  });

  await t.step("resources/list returns agent resources", async () => {
    const req = createRequest(createJsonRpcRequest("resources/list"));
    const resp = await handleMcpPost("agent-123", req, session);
    const body = await resp.json();

    assertExists(body.result);
    assertExists(body.result.resources);
    assertEquals(body.result.resources.length >= 2, true);

    const uris = body.result.resources.map((r: { uri: string }) => r.uri);
    assertEquals(uris.includes("chaos://agent/agent-123/activity"), true);
    assertEquals(uris.includes("chaos://agent/agent-123/claudemd"), true);
  });

  await t.step("prompts/list returns prompt templates", async () => {
    const req = createRequest(createJsonRpcRequest("prompts/list"));
    const resp = await handleMcpPost("agent-123", req, session);
    const body = await resp.json();

    assertExists(body.result);
    assertExists(body.result.prompts);
    assertEquals(body.result.prompts.length >= 2, true);
  });

  await t.step("ping returns empty result", async () => {
    const req = createRequest(createJsonRpcRequest("ping"));
    const resp = await handleMcpPost("agent-123", req, session);
    const body = await resp.json();

    assertEquals(body.jsonrpc, "2.0");
    assertExists(body.result);
  });

  await t.step("unknown method returns -32601", async () => {
    const req = createRequest(createJsonRpcRequest("nonexistent/method"));
    const resp = await handleMcpPost("agent-123", req, session);
    const body = await resp.json();

    assertEquals(body.jsonrpc, "2.0");
    assertExists(body.error);
    assertEquals(body.error.code, -32601);
  });

  await t.step("invalid JSON returns -32700", async () => {
    const req = new Request("https://relay.example.com/mcp/agent-123", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json",
    });

    const resp = await handleMcpPost("agent-123", req, session);
    const body = await resp.json();

    assertEquals(resp.status, 400);
    assertEquals(body.error.code, -32700);
  });

  await t.step(
    "tools/call without extension returns offline error",
    async () => {
      const req = createRequest(createJsonRpcRequest("tools/call", {
        name: "chat",
        arguments: { message: "Hello" },
      }));

      const resp = await handleMcpPost("agent-123", req, session);
      const body = await resp.json();

      assertExists(body.error);
      assertEquals(body.error.code, -32000);
      assertEquals(body.error.message.includes("offline"), true);
    },
  );

  await t.step("tools/call without tool name returns -32602", async () => {
    const req = createRequest(createJsonRpcRequest("tools/call", {}));
    const resp = await handleMcpPost("agent-123", req, session);
    const body = await resp.json();

    assertExists(body.error);
    assertEquals(body.error.code, -32602);
  });

  await t.step("batch request handles multiple JSON-RPC requests", async () => {
    const batch = JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { jsonrpc: "2.0", id: 2, method: "resources/list" },
      { jsonrpc: "2.0", id: 3, method: "ping" },
    ]);
    const req = new Request("https://relay.example.com/mcp/agent-123", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: batch,
    });

    const resp = await handleMcpPost("agent-123", req, session);
    const body = await resp.json();

    assertEquals(Array.isArray(body), true);
    assertEquals(body.length, 3);
    assertEquals(body[0].id, 1);
    assertEquals(body[1].id, 2);
    assertEquals(body[2].id, 3);
  });

  await t.step("notification (no id) returns 202", async () => {
    const req = createRequest(JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }));

    const resp = await handleMcpPost("agent-123", req, session);
    assertEquals(resp.status, 202);
  });

  await t.step("handleMcpResponse resolves pending requests", async () => {
    // This tests the correlation mechanism
    // Since we can't easily create a pending request without a connected extension,
    // we test that unknown correlation IDs are handled gracefully
    handleMcpResponse("unknown-id", {
      jsonrpc: "2.0",
      id: 1,
      result: { ok: true },
    });
    // Should not throw — just logs a warning
  });
});
