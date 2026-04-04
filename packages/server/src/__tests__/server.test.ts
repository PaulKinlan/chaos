// Server integration tests
// Run with: deno test --allow-net --allow-read --allow-env

import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const BASE = 'http://localhost:8787';

// Helper to make authenticated requests
async function authFetch(
  apiKey: string,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...(options.headers || {}),
    },
  });
}

// Start the server before tests, stop after
let serverProcess: Deno.ChildProcess;

async function startServer(): Promise<void> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ['run', '--allow-net', '--allow-read', '--allow-env', 'src/main.ts'],
    cwd: new URL('../../', import.meta.url).pathname,
    stdout: 'piped',
    stderr: 'piped',
    env: { PORT: '8787' },
  });
  serverProcess = command.spawn();

  // Wait for server to be ready
  for (let i = 0; i < 30; i++) {
    try {
      const resp = await fetch(`${BASE}/health`);
      if (resp.ok) return;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Server did not start in time');
}

async function stopServer(): Promise<void> {
  try {
    serverProcess.kill('SIGTERM');
    await serverProcess.status;
  } catch {
    // Already dead
  }
}

// ── Tests ──

Deno.test({
  name: 'server integration tests',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    await startServer();

    try {
      await t.step('GET /health returns ok', async () => {
        const resp = await fetch(`${BASE}/health`);
        assertEquals(resp.status, 200);
        const body = await resp.json();
        assertEquals(body.status, 'ok');
        assertExists(body.version);
      });

      let apiKey: string;
      let userId: string;

      await t.step('POST /auth/register creates session', async () => {
        const resp = await fetch(`${BASE}/auth/register`, { method: 'POST' });
        assertEquals(resp.status, 200);
        const body = await resp.json();
        assertExists(body.userId);
        assertExists(body.apiKey);
        apiKey = body.apiKey;
        userId = body.userId;
      });

      await t.step('GET /messages without auth returns 401', async () => {
        const resp = await fetch(`${BASE}/messages`);
        assertEquals(resp.status, 401);
      });

      await t.step('GET /messages with auth returns empty', async () => {
        const resp = await authFetch(apiKey, '/messages');
        assertEquals(resp.status, 200);
        const body = await resp.json();
        assertEquals(body.messages.length, 0);
        assertExists(body.since);
      });

      let channelId: string;
      let webhookUrl: string;

      await t.step('POST /channels registers a webhook channel', async () => {
        const resp = await authFetch(apiKey, '/channels', {
          method: 'POST',
          body: JSON.stringify({ type: 'webhook', agentId: 'test-agent' }),
        });
        assertEquals(resp.status, 201);
        const body = await resp.json();
        assertExists(body.channel.id);
        assertEquals(body.channel.type, 'webhook');
        assertExists(body.webhookUrl);
        channelId = body.channel.id;
        webhookUrl = body.webhookUrl;
      });

      await t.step('GET /channels lists channels', async () => {
        const resp = await authFetch(apiKey, '/channels');
        assertEquals(resp.status, 200);
        const body = await resp.json();
        assertEquals(body.channels.length, 1);
        assertEquals(body.channels[0].id, channelId);
      });

      await t.step('POST /webhook/:channelId ingests a message', async () => {
        const resp = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'Hello from webhook!', sender: 'test' }),
        });
        assertEquals(resp.status, 200);
        const body = await resp.json();
        assertEquals(body.ok, true);
        assertExists(body.messageId);
      });

      await t.step('GET /messages returns the webhook message', async () => {
        const resp = await authFetch(apiKey, '/messages');
        assertEquals(resp.status, 200);
        const body = await resp.json();
        assertEquals(body.messages.length, 1);
        assertEquals(body.messages[0].channelType, 'webhook');
        assertEquals(body.messages[0].channelId, channelId);
      });

      await t.step('GET /messages with since filters old messages', async () => {
        // Use a future timestamp so nothing matches
        const future = new Date(Date.now() + 60000).toISOString();
        const resp = await authFetch(apiKey, `/messages?since=${encodeURIComponent(future)}`);
        assertEquals(resp.status, 200);
        const body = await resp.json();
        assertEquals(body.messages.length, 0);
      });

      await t.step('POST /reply stores a response', async () => {
        const resp = await authFetch(apiKey, '/reply', {
          method: 'POST',
          body: JSON.stringify({
            channelType: 'webhook',
            channelId,
            content: 'Agent response here',
          }),
        });
        assertEquals(resp.status, 200);
        const body = await resp.json();
        assertEquals(body.ok, true);
        assertExists(body.responseId);
      });

      await t.step('GET /responses/:channelId returns stored responses', async () => {
        const resp = await fetch(`${BASE}/responses/${channelId}`);
        assertEquals(resp.status, 200);
        const body = await resp.json();
        assertEquals(body.responses.length, 1);
        assertEquals(body.responses[0].content, 'Agent response here');
      });

      await t.step('POST /webhook/:channelId with bad token returns 401', async () => {
        const badUrl = `${BASE}/webhook/${channelId}?token=wrong-token`;
        const resp = await fetch(badUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'Should fail' }),
        });
        assertEquals(resp.status, 401);
      });

      await t.step('DELETE /channels/:id removes a channel', async () => {
        const resp = await authFetch(apiKey, `/channels/${channelId}`, {
          method: 'DELETE',
        });
        assertEquals(resp.status, 200);
        const body = await resp.json();
        assertEquals(body.ok, true);

        // Verify it's gone
        const listResp = await authFetch(apiKey, '/channels');
        const listBody = await listResp.json();
        assertEquals(listBody.channels.length, 0);
      });

      await t.step('DELETE /channels/:id for nonexistent returns 404', async () => {
        const resp = await authFetch(apiKey, '/channels/nonexistent', {
          method: 'DELETE',
        });
        assertEquals(resp.status, 404);
      });
    } finally {
      await stopServer();
    }
  },
});
