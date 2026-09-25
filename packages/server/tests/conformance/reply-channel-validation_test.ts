// Conformance tests: reply channel validation (journal-xk4).
//
// THE GUARD: a reply whose channelId names no registered channel must be
// REFUSED BY NAME — an accepted send to a channel that does not exist is
// indistinguishable from delivery, which is how a mistyped id silently
// swallowed Paul's message on 2026-09-20. And a successful reply must name
// the channel the relay actually resolved, so the confirmation is an
// observation, not an echo of the request.

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authedFetch, getBaseUrl, register } from "./helpers.ts";

const base = getBaseUrl();

function wsUrl(path: string): string {
  return base.replace(/^http/, "ws") + path;
}

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
      reject(
        new Error(`WebSocket error: ${(e as ErrorEvent).message || "unknown"}`),
      );
    };
  });
}

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

async function closeWs(ws: WebSocket): Promise<void> {
  ws.close();
  await new Promise<void>((resolve) => {
    ws.onclose = () => resolve();
    if (ws.readyState === WebSocket.CLOSED) resolve();
  });
}

/** Create a webhook channel on the session and return its id. */
async function createWebhookChannel(
  creds: Parameters<typeof authedFetch>[2],
): Promise<{ id: string; name?: string }> {
  const createResp = await authedFetch(
    `${base}/channels`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "webhook", name: "validation-hook" }),
    },
    creds,
  );
  assertEquals(createResp.status, 201);
  const { channel } = await createResp.json();
  assertExists(channel.id);
  return channel;
}

Deno.test("POST /reply with an unknown channelId is refused by name", async () => {
  const creds = await register();
  const bogus = crypto.randomUUID();

  const resp = await authedFetch(
    `${base}/reply`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channelType: "telegram",
        channelId: bogus,
        content: "reply to a channel that does not exist",
      }),
    },
    creds,
  );

  const okRange = resp.status >= 200 && resp.status < 300;
  assertEquals(okRange, false, `expected a refusal, got HTTP ${resp.status}`);
  const data = await resp.json();
  assertEquals(data.ok ?? false, false, "a refusal must not report ok:true");
  assertExists(data.error, "a refusal must carry the reason");
  // The reason must name the channelId so the caller can see the typo.
  assertEquals(
    String(data.error).includes(bogus),
    true,
    "refusal must name the unknown channelId",
  );
});

Deno.test("POST /reply with a channelType mismatch is refused naming both types", async () => {
  const creds = await register();
  const channel = await createWebhookChannel(creds);

  const resp = await authedFetch(
    `${base}/reply`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Same id, wrong type — this is the near-miss typo shape.
        channelType: "telegram",
        channelId: channel.id,
        content: "wrong type on purpose",
      }),
    },
    creds,
  );

  const okRange = resp.status >= 200 && resp.status < 300;
  assertEquals(okRange, false, `expected a refusal, got HTTP ${resp.status}`);
  const data = await resp.json();
  assertExists(data.error, "a refusal must carry the reason");
  const reason = String(data.error);
  assertEquals(
    reason.includes("telegram") && reason.includes("webhook"),
    true,
    `refusal must name both the requested and the actual type, got: ${reason}`,
  );
});

Deno.test("POST /reply to a known channel succeeds and names the resolved channel", async () => {
  const creds = await register();
  const channel = await createWebhookChannel(creds);

  const resp = await authedFetch(
    `${base}/reply`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channelType: "webhook",
        channelId: channel.id,
        content: "reply to a known channel",
      }),
    },
    creds,
  );
  assertEquals(resp.status, 200);
  const data = await resp.json();
  assertEquals(data.ok, true);
  assertExists(data.responseId);

  // The success result carries the channel the relay actually resolved —
  // id, type, and a human label — so a client can confirm against
  // observation, not against its own request echo.
  assertExists(data.channel, "success must name the resolved channel");
  assertEquals(data.channel.id, channel.id);
  assertEquals(data.channel.type, "webhook");
  assertEquals(
    typeof data.channel.label === "string" && data.channel.label.length > 0,
    true,
    "resolved channel must carry a non-empty human label",
  );
});

Deno.test("WebSocket reply to an unknown channelId is refused by name in the ack", async () => {
  const creds = await register();
  const bogus = crypto.randomUUID();
  const ws = await connectWs(wsUrl(`/ws?token=${creds.apiKey}`));

  try {
    ws.send(
      JSON.stringify({
        type: "reply",
        channelType: "webhook",
        channelId: bogus,
        content: "ws reply to a channel that does not exist",
      }),
    );

    const ack = await waitForMessage(
      ws,
      (data) => data.type === "reply_ack" || data.type === "error",
      5000,
    );
    // Either a negative reply_ack or an error frame — what must NOT happen is
    // an ok:true that reads as delivery for a channel that does not exist.
    assertEquals(
      ack.ok ?? false,
      false,
      `expected a refusal, got: ${JSON.stringify(ack)}`,
    );
    const reason = String(ack.error ?? "");
    assertEquals(
      reason.includes(bogus),
      true,
      `refusal must name the unknown channelId, got: ${reason}`,
    );
  } finally {
    await closeWs(ws);
  }
});

Deno.test("WebSocket reply to a known channel names the resolved channel in the ack", async () => {
  const creds = await register();
  const channel = await createWebhookChannel(creds);
  const ws = await connectWs(wsUrl(`/ws?token=${creds.apiKey}`));

  try {
    ws.send(
      JSON.stringify({
        type: "reply",
        channelType: "webhook",
        channelId: channel.id,
        content: "ws reply to a known channel",
      }),
    );

    const ack = await waitForMessage(
      ws,
      (data) => data.type === "reply_ack",
      5000,
    );
    assertEquals(ack.ok, true);
    assertExists(ack.responseId);
    const resolved = ack.channel as Record<string, unknown> | undefined;
    assertExists(resolved, "ack must name the resolved channel");
    assertEquals(resolved!.id, channel.id);
    assertEquals(resolved!.type, "webhook");
    assertEquals(
      typeof resolved!.label === "string" && resolved!.label.length > 0,
      true,
      "resolved channel must carry a non-empty human label",
    );
  } finally {
    await closeWs(ws);
  }
});
