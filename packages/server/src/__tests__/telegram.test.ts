// Telegram channel integration tests
// Run with: deno test --allow-net --allow-read --allow-env

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const BASE = "http://localhost:8787";

// Helper to make authenticated requests
async function authFetch(
  apiKey: string,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      ...(options.headers || {}),
    },
  });
}

// Mock Telegram API server
let mockTelegramServer: Deno.HttpServer | undefined;
let telegramRequests: { method: string; body: unknown }[] = [];

function startMockTelegram(port: number): void {
  telegramRequests = [];
  mockTelegramServer = Deno.serve(
    { port, onListen: () => {} },
    async (req: Request) => {
      const url = new URL(req.url);
      const path = url.pathname;

      // Extract the method from the URL (e.g., /bot123:abc/getMe -> getMe)
      const methodMatch = path.match(/\/bot[^/]+\/(\w+)$/);
      const method = methodMatch ? methodMatch[1] : "";

      let body: unknown = null;
      if (req.method === "POST") {
        try {
          body = await req.json();
        } catch {
          body = null;
        }
      }
      telegramRequests.push({ method, body });

      if (method === "getMe") {
        return new Response(
          JSON.stringify({
            ok: true,
            result: {
              id: 123456,
              is_bot: true,
              first_name: "TestBot",
              username: "test_chaos_bot",
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      if (method === "setWebhook") {
        return new Response(
          JSON.stringify({
            ok: true,
            result: true,
            description: "Webhook was set",
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      if (method === "sendMessage") {
        return new Response(
          JSON.stringify({
            ok: true,
            result: {
              message_id: 42,
              chat: { id: (body as Record<string, unknown>)?.chat_id || 0 },
              text: (body as Record<string, unknown>)?.text || "",
              date: Math.floor(Date.now() / 1000),
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ ok: false, description: "Unknown method" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    },
  );
}

async function stopMockTelegram(): Promise<void> {
  if (mockTelegramServer) {
    await mockTelegramServer.shutdown();
    mockTelegramServer = undefined;
  }
}

// Start the real server
let serverProcess: Deno.ChildProcess;

async function startServer(): Promise<void> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-net", "--allow-read", "--allow-env", "src/main.ts"],
    cwd: new URL("../../", import.meta.url).pathname,
    stdout: "piped",
    stderr: "piped",
    env: { PORT: "8787" },
  });
  serverProcess = command.spawn();

  for (let i = 0; i < 30; i++) {
    try {
      const resp = await fetch(`${BASE}/health`);
      if (resp.ok) return;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Server did not start in time");
}

async function stopServer(): Promise<void> {
  try {
    serverProcess.kill("SIGTERM");
    await serverProcess.status;
  } catch {
    // Already dead
  }
}

Deno.test({
  name: "telegram channel tests",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    await startServer();

    try {
      // Register a user session
      const regResp = await fetch(`${BASE}/auth/register`, { method: "POST" });
      const { apiKey } = await regResp.json();

      await t.step(
        "POST /channels/telegram/register without botToken returns 400",
        async () => {
          const resp = await authFetch(apiKey, "/channels/telegram/register", {
            method: "POST",
            body: JSON.stringify({}),
          });
          assertEquals(resp.status, 400);
          const body = await resp.json();
          assertExists(body.error);
        },
      );

      await t.step(
        "POST /channels/telegram/register without auth returns 401",
        async () => {
          const resp = await fetch(`${BASE}/channels/telegram/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ botToken: "fake:token" }),
          });
          assertEquals(resp.status, 401);
        },
      );

      // Note: Full registration test requires mocking Telegram API calls.
      // The telegram.ts module calls api.telegram.org directly, so a real
      // integration test would need a valid bot token or a mock Telegram server.
      // We test the webhook handling below which doesn't require external API calls.

      await t.step(
        "POST /telegram/:channelId for unknown channel returns 404",
        async () => {
          const resp = await fetch(
            `${BASE}/telegram/nonexistent-channel?secret=foo`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                update_id: 1,
                message: {
                  message_id: 1,
                  from: {
                    id: 100,
                    is_bot: false,
                    first_name: "Alice",
                    username: "alice",
                  },
                  chat: { id: 200, type: "private" },
                  date: Math.floor(Date.now() / 1000),
                  text: "Hello bot",
                },
              }),
            },
          );
          assertEquals(resp.status, 404);
        },
      );

      // To test actual webhook ingestion, we manually create a telegram channel
      // by registering it via the generic channel endpoint (simulating what
      // registerTelegramBot would create after validating with Telegram)
      let channelId: string;
      const webhookSecret = "test-secret-123";

      await t.step(
        "register a telegram channel via generic endpoint (for testing)",
        async () => {
          const resp = await authFetch(apiKey, "/channels", {
            method: "POST",
            body: JSON.stringify({
              type: "telegram",
              agentId: "test-agent",
              enabled: true,
              metadata: {
                botToken: "fake:token",
                botUsername: "test_bot",
                webhookSecret,
                // Pre-paired: sender 100 is already allowlisted. Channels are
                // fail-closed (locked until a user pairs), so ingestion tests
                // below would otherwise be rejected as unauthorized.
                allowedUsers: ["100"],
              },
            }),
          });
          assertEquals(resp.status, 201);
          const body = await resp.json();
          channelId = body.channel.id;
          assertExists(channelId);
          assertEquals(body.channel.type, "telegram");
        },
      );

      await t.step(
        "POST /telegram/:channelId with wrong secret returns 401",
        async () => {
          const resp = await fetch(
            `${BASE}/telegram/${channelId}?secret=wrong-secret`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                update_id: 2,
                message: {
                  message_id: 2,
                  from: {
                    id: 100,
                    is_bot: false,
                    first_name: "Alice",
                    username: "alice",
                  },
                  chat: { id: 200, type: "private" },
                  date: Math.floor(Date.now() / 1000),
                  text: "Should be rejected",
                },
              }),
            },
          );
          assertEquals(resp.status, 401);
        },
      );

      await t.step(
        "POST /telegram/:channelId with valid secret ingests message",
        async () => {
          const resp = await fetch(
            `${BASE}/telegram/${channelId}?secret=${webhookSecret}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                update_id: 3,
                message: {
                  message_id: 3,
                  from: {
                    id: 100,
                    is_bot: false,
                    first_name: "Alice",
                    username: "alice",
                  },
                  chat: { id: 200, type: "private" },
                  date: Math.floor(Date.now() / 1000),
                  text: "Hello from Telegram!",
                },
              }),
            },
          );
          assertEquals(resp.status, 200);
          const body = await resp.json();
          assertEquals(body.ok, true);
          assertExists(body.messageId);
        },
      );

      await t.step("GET /messages returns the Telegram message", async () => {
        const resp = await authFetch(apiKey, "/messages");
        assertEquals(resp.status, 200);
        const body = await resp.json();
        const telegramMsgs = body.messages.filter((
          m: { channelType: string },
        ) => m.channelType === "telegram");
        assertEquals(telegramMsgs.length, 1);
        assertEquals(telegramMsgs[0].content, "Hello from Telegram!");
        assertEquals(telegramMsgs[0].from, "alice");
        assertEquals(telegramMsgs[0].metadata.chatId, 200);
      });

      await t.step(
        "POST /telegram/:channelId handles edited messages",
        async () => {
          const resp = await fetch(
            `${BASE}/telegram/${channelId}?secret=${webhookSecret}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                update_id: 4,
                edited_message: {
                  message_id: 3,
                  from: {
                    id: 100,
                    is_bot: false,
                    first_name: "Alice",
                    username: "alice",
                  },
                  chat: { id: 200, type: "private" },
                  date: Math.floor(Date.now() / 1000),
                  edit_date: Math.floor(Date.now() / 1000),
                  text: "Hello from Telegram! (edited)",
                },
              }),
            },
          );
          assertEquals(resp.status, 200);
          const body = await resp.json();
          assertEquals(body.ok, true);
        },
      );

      await t.step(
        "POST /telegram/:channelId handles callback queries",
        async () => {
          const resp = await fetch(
            `${BASE}/telegram/${channelId}?secret=${webhookSecret}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                update_id: 5,
                callback_query: {
                  id: "cb-1",
                  from: {
                    id: 100,
                    is_bot: false,
                    first_name: "Alice",
                    username: "alice",
                  },
                  message: {
                    message_id: 10,
                    chat: { id: 200, type: "private" },
                    date: Math.floor(Date.now() / 1000),
                  },
                  data: "button_clicked",
                },
              }),
            },
          );
          assertEquals(resp.status, 200);
          const body = await resp.json();
          assertEquals(body.ok, true);
        },
      );

      await t.step(
        "POST /telegram/:channelId ignores updates without text",
        async () => {
          const resp = await fetch(
            `${BASE}/telegram/${channelId}?secret=${webhookSecret}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                update_id: 6,
                message: {
                  message_id: 20,
                  from: { id: 100, is_bot: false, first_name: "Alice" },
                  chat: { id: 200, type: "private" },
                  date: Math.floor(Date.now() / 1000),
                  // No text field (e.g., a photo-only message)
                },
              }),
            },
          );
          assertEquals(resp.status, 200);
          const body = await resp.json();
          assertEquals(body.ok, true);
          // No messageId since it was ignored
          assertEquals(body.messageId, undefined);
        },
      );

      await t.step(
        "POST /telegram/:channelId rejects invalid JSON",
        async () => {
          const resp = await fetch(
            `${BASE}/telegram/${channelId}?secret=${webhookSecret}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "not valid json",
            },
          );
          assertEquals(resp.status, 400);
        },
      );

      await t.step(
        "POST /reply for telegram channel stores response",
        async () => {
          const resp = await authFetch(apiKey, "/reply", {
            method: "POST",
            body: JSON.stringify({
              channelType: "telegram",
              channelId,
              content: "Agent reply via Telegram",
              metadata: { chatId: 200 },
            }),
          });
          assertEquals(resp.status, 200);
          const body = await resp.json();
          assertEquals(body.ok, true);
          assertExists(body.responseId);
        },
      );

      await t.step(
        "GET /responses/:channelId returns telegram responses",
        async () => {
          const resp = await fetch(`${BASE}/responses/${channelId}`);
          assertEquals(resp.status, 200);
          const body = await resp.json();
          const telegramResps = body.responses.filter((
            r: { channelType: string },
          ) => r.channelType === "telegram");
          assertEquals(telegramResps.length, 1);
          assertEquals(telegramResps[0].content, "Agent reply via Telegram");
        },
      );
      // ── Security: an unpaired channel is fail-closed ──
      await t.step(
        "unpaired channel rejects messages until the pairing code is sent",
        async () => {
          // Fresh channel with a pairing code and NO allowlist (the real
          // registration default).
          const reg = await authFetch(apiKey, "/channels", {
            method: "POST",
            body: JSON.stringify({
              type: "telegram",
              agentId: "test-agent",
              enabled: true,
              metadata: {
                botToken: "fake:token",
                botUsername: "locked_bot",
                webhookSecret,
                pairingCode: "PAIR1234",
              },
            }),
          });
          assertEquals(reg.status, 201);
          const lockedId = (await reg.json()).channel.id as string;

          const post = (text: string, updateId: number) =>
            fetch(`${BASE}/telegram/${lockedId}?secret=${webhookSecret}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                update_id: updateId,
                message: {
                  message_id: updateId,
                  from: { id: 777, is_bot: false, first_name: "Mallory" },
                  chat: { id: 888, type: "private" },
                  date: Math.floor(Date.now() / 1000),
                  text,
                },
              }),
            });

          // 1. Stranger message before pairing — accepted by the webhook (200)
          //    but NOT ingested (no messageId), so it never reaches the agent.
          const before = await post("let me in", 901);
          assertEquals(before.status, 200);
          assertEquals((await before.json()).messageId, undefined);

          // 2. Send the pairing code — links the sender.
          const pair = await post("PAIR1234", 902);
          assertEquals(pair.status, 200);

          // 3. Same sender, now paired — message is ingested.
          const after = await post("now I'm in", 903);
          assertEquals(after.status, 200);
          assertExists((await after.json()).messageId);

          // The pre-pairing "let me in" must never have been stored.
          const msgs = await authFetch(apiKey, "/messages");
          const contents = (await msgs.json()).messages
            .filter((m: { channelId: string }) => m.channelId === lockedId)
            .map((m: { content: string }) => m.content);
          assertEquals(contents.includes("let me in"), false);
          assertEquals(contents.includes("now I'm in"), true);
        },
      );
    } finally {
      await stopServer();
      await stopMockTelegram();
    }
  },
});
