// CHAOS Relay Server
// Handles message relay between external channels and the Chrome extension

import { validateAuth, createSession, addChannel, removeChannel, getChannels } from './auth.ts';
import { getMessages, getResponses } from './store.ts';
import { handleWebhook } from './channels/webhook.ts';
import { handleReply, type ReplyPayload } from './channels/responder.ts';
import { registerTelegramBot, handleTelegramWebhook } from './channels/telegram.ts';
import type { ChannelConfig } from '@chaos/shared';

const PORT = parseInt(Deno.env.get('PORT') || '8787');
const VERSION = '0.1.0';

// CORS headers for cross-origin requests from the extension
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

Deno.serve({ port: PORT }, async (req: Request) => {
  const url = new URL(req.url);
  const method = req.method;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // ── Public endpoints (no auth) ──

  // Health check
  if (url.pathname === '/health' && method === 'GET') {
    return json({ status: 'ok', version: VERSION });
  }

  // Auth registration
  if (url.pathname === '/auth/register' && method === 'POST') {
    const session = createSession();
    return json({ userId: session.userId, apiKey: session.apiKey });
  }

  // Webhook ingestion (auth via URL token, not Bearer)
  const webhookMatch = url.pathname.match(/^\/webhook\/([^/]+)$/);
  if (webhookMatch && method === 'POST') {
    const channelId = webhookMatch[1];
    const resp = await handleWebhook(channelId, req);
    // Add CORS headers to webhook responses too
    const body = await resp.text();
    return new Response(body, {
      status: resp.status,
      headers: { ...Object.fromEntries(resp.headers.entries()), ...corsHeaders },
    });
  }

  // Responses endpoint (for external services to poll for agent replies)
  const responsesMatch = url.pathname.match(/^\/responses\/([^/]+)$/);
  if (responsesMatch && method === 'GET') {
    const channelId = responsesMatch[1];
    const since = url.searchParams.get('since') || undefined;
    const responses = getResponses(channelId, since);
    return json({ responses, since: new Date().toISOString() });
  }

  // Telegram webhook ingestion (auth via URL secret, not Bearer)
  const telegramMatch = url.pathname.match(/^\/telegram\/([^/]+)$/);
  if (telegramMatch && method === 'POST') {
    const channelId = telegramMatch[1];
    const resp = await handleTelegramWebhook(channelId, req);
    const body = await resp.text();
    return new Response(body, {
      status: resp.status,
      headers: { ...Object.fromEntries(resp.headers.entries()), ...corsHeaders },
    });
  }

  // ── Authenticated endpoints ──

  const session = validateAuth(req);
  if (!session) {
    return error('Unauthorized. Include Authorization: Bearer <apiKey>', 401);
  }

  // Poll for messages
  if (url.pathname === '/messages' && method === 'GET') {
    const since = url.searchParams.get('since') || undefined;
    const messages = getMessages(session.userId, since);
    return json({ messages, since: new Date().toISOString() });
  }

  // Send a reply
  if (url.pathname === '/reply' && method === 'POST') {
    try {
      const payload: ReplyPayload = await req.json();
      if (!payload.channelId || !payload.content) {
        return error('Missing channelId or content');
      }
      const result = handleReply(session.userId, payload);
      return json(result);
    } catch {
      return error('Invalid JSON body');
    }
  }

  // Register a Telegram bot channel
  if (url.pathname === '/channels/telegram/register' && method === 'POST') {
    try {
      const body = await req.json();
      const botToken = body.botToken;
      if (!botToken || typeof botToken !== 'string') {
        return error('Missing or invalid botToken');
      }

      const channelId = crypto.randomUUID();
      const serverBaseUrl = url.origin;

      const { botUsername, webhookSecret } = await registerTelegramBot(
        session.userId,
        botToken,
        serverBaseUrl,
        channelId,
      );

      const channel: ChannelConfig = {
        id: channelId,
        type: 'telegram',
        agentId: body.agentId || '',
        enabled: true,
        metadata: {
          botToken,
          botUsername,
          webhookSecret,
        },
      };

      addChannel(session.userId, channel);

      return json({ channelId, botUsername }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return error(`Telegram registration failed: ${message}`);
    }
  }

  // Register a channel
  if (url.pathname === '/channels' && method === 'POST') {
    try {
      const body = await req.json();
      const channel: ChannelConfig = {
        id: body.id || crypto.randomUUID(),
        type: body.type || 'webhook',
        agentId: body.agentId || '',
        enabled: body.enabled !== false,
        metadata: body.metadata || {},
      };

      // For webhook channels, generate a secret token
      if (channel.type === 'webhook' && !channel.metadata['webhookSecret']) {
        channel.metadata['webhookSecret'] = crypto.randomUUID();
      }

      addChannel(session.userId, channel);

      // Build the webhook URL for the user
      const webhookUrl = channel.type === 'webhook'
        ? `${url.origin}/webhook/${channel.id}?token=${channel.metadata['webhookSecret']}`
        : undefined;

      return json({ channel, webhookUrl }, 201);
    } catch {
      return error('Invalid JSON body');
    }
  }

  // List channels
  if (url.pathname === '/channels' && method === 'GET') {
    const channels = getChannels(session.userId);
    return json({ channels });
  }

  // Delete a channel
  const channelDeleteMatch = url.pathname.match(/^\/channels\/([^/]+)$/);
  if (channelDeleteMatch && method === 'DELETE') {
    const channelId = channelDeleteMatch[1];
    const removed = removeChannel(session.userId, channelId);
    if (!removed) {
      return error('Channel not found', 404);
    }
    return json({ ok: true });
  }

  return error('Not found', 404);
});

console.log(`CHAOS relay server running on port ${PORT}`);
