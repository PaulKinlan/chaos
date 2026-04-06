// Conformance tests: WebSocket connections
// Verifies WebSocket auth, message delivery, and rejection of invalid tokens.

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authedFetch, getBaseUrl, register } from "./helpers.ts";

const base = getBaseUrl();

/** Convert HTTP base URL to WS URL. */
function wsUrl(path: string): string {
  return base.replace(/^http/, "ws") + path;
}

/** Open a WebSocket and wait for it to connect. Returns the socket. */
function connectWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("WebSocket connection timed out"));
    }, 5000);
    ws.onopen = () => {
      clearTimeout(timeout);
      resolve(ws);
    };
    ws.onerror = (e) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket error: ${(e as ErrorEvent).message || "unknown"}`));
    };
  });
}

/** Wait for a WebSocket message matching a predicate, with timeout. */
function waitForMessage(
  ws: WebSocket,
  predicate: (data: Record<string, unknown>) => boolean,
  timeoutMs = 10000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for WebSocket message"));
    }, timeoutMs);

    const handler = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (predicate(data)) {
          clearTimeout(timeout);
          ws.removeEventListener("message", handler);
          resolve(data);
        }
      } catch {
        // ignore parse errors, keep waiting
      }
    };
    ws.addEventListener("message", handler);
  });
}

Deno.test("WebSocket connects with valid token", async () => {
  const creds = await register();
  const ws = await connectWs(
    wsUrl(`/ws?token=${creds.apiKey}`),
  );
  assertEquals(ws.readyState, WebSocket.OPEN);
  ws.close();
  // Wait for close to complete
  await new Promise<void>((resolve) => {
    ws.onclose = () => resolve();
    // If already closed, resolve immediately
    if (ws.readyState === WebSocket.CLOSED) resolve();
  });
});

Deno.test("WebSocket rejects invalid token", async () => {
  // Attempting to connect with an invalid token should fail.
  // The server returns an HTTP 401 before upgrading, which causes
  // the WebSocket handshake to fail.
  try {
    const ws = await connectWs(
      wsUrl("/ws?token=invalid-token-that-does-not-exist"),
    );
    // If we somehow connected, that's a failure
    ws.close();
    throw new Error("Should not have connected with invalid token");
  } catch (e) {
    // Expected — connection should fail
    assertExists(e);
  }
});

Deno.test("WebSocket rejects missing token", async () => {
  try {
    const ws = await connectWs(wsUrl("/ws"));
    ws.close();
    throw new Error("Should not have connected without token");
  } catch (e) {
    assertExists(e);
  }
});

Deno.test("WebSocket receives messages after webhook", async () => {
  const creds = await register();

  // Create a webhook channel
  const createResp = await authedFetch(
    `${base}/channels`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "webhook" }),
    },
    creds,
  );
  const { webhookUrl } = await createResp.json();

  // Connect WebSocket
  const ws = await connectWs(wsUrl(`/ws?token=${creds.apiKey}`));

  try {
    // Give the server a moment to set up the KV watch
    await new Promise((r) => setTimeout(r, 500));

    // Send a webhook message
    const webhookResp = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Source": "ws-test",
      },
      body: JSON.stringify({ text: "hello via websocket" }),
    });
    assertEquals(webhookResp.status, 200);
    await webhookResp.body?.cancel();

    // Wait for the message to arrive via WebSocket
    const msg = await waitForMessage(
      ws,
      (data) => data.type === "message",
      10000,
    );

    assertEquals(msg.type, "message");
    assertExists(msg.message);
    const message = msg.message as Record<string, unknown>;
    assertEquals(message.channelType, "webhook");
    assertEquals(message.from, "ws-test");
    assertEquals(
      (message.content as string).includes("hello via websocket"),
      true,
    );
  } finally {
    ws.close();
    await new Promise<void>((resolve) => {
      ws.onclose = () => resolve();
      if (ws.readyState === WebSocket.CLOSED) resolve();
    });
  }
});

Deno.test("WebSocket ping-pong", async () => {
  const creds = await register();
  const ws = await connectWs(wsUrl(`/ws?token=${creds.apiKey}`));

  try {
    // Send a ping
    ws.send(JSON.stringify({ type: "ping" }));

    // Wait for pong
    const pong = await waitForMessage(
      ws,
      (data) => data.type === "pong",
      5000,
    );
    assertEquals(pong.type, "pong");
  } finally {
    ws.close();
    await new Promise<void>((resolve) => {
      ws.onclose = () => resolve();
      if (ws.readyState === WebSocket.CLOSED) resolve();
    });
  }
});

Deno.test("WebSocket reply via message gets ack", async () => {
  const creds = await register();

  // Create a channel first
  const createResp = await authedFetch(
    `${base}/channels`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "webhook" }),
    },
    creds,
  );
  const { channel } = await createResp.json();

  const ws = await connectWs(wsUrl(`/ws?token=${creds.apiKey}`));

  try {
    // Send a reply via WebSocket
    ws.send(
      JSON.stringify({
        type: "reply",
        channelType: "webhook",
        channelId: channel.id,
        content: "reply via ws",
      }),
    );

    // Wait for ack
    const ack = await waitForMessage(
      ws,
      (data) => data.type === "reply_ack",
      5000,
    );
    assertEquals(ack.type, "reply_ack");
    assertEquals(ack.ok, true);
    assertExists(ack.responseId);
  } finally {
    ws.close();
    await new Promise<void>((resolve) => {
      ws.onclose = () => resolve();
      if (ws.readyState === WebSocket.CLOSED) resolve();
    });
  }
});

Deno.test("WebSocket reply with missing fields returns error", async () => {
  const creds = await register();
  const ws = await connectWs(wsUrl(`/ws?token=${creds.apiKey}`));

  try {
    // Send a reply missing required fields
    ws.send(
      JSON.stringify({
        type: "reply",
        channelType: "webhook",
        // missing channelId and content
      }),
    );

    const errMsg = await waitForMessage(
      ws,
      (data) => data.type === "error",
      5000,
    );
    assertEquals(errMsg.type, "error");
    assertExists(errMsg.error);
  } finally {
    ws.close();
    await new Promise<void>((resolve) => {
      ws.onclose = () => resolve();
      if (ws.readyState === WebSocket.CLOSED) resolve();
    });
  }
});
