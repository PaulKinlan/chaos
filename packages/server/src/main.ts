// CHAOS Relay Server
// Handles message relay between external channels and the Chrome extension

import { validateAuth, createSession, addChannel, removeChannel, getChannels, getSessionByApiKey, type UserSession } from './auth.ts';
import { getMessages, getResponses, startMessageCleanup } from './store.ts';
import { handleWebhook } from './channels/webhook.ts';
import { handleReply, type ReplyPayload } from './channels/responder.ts';
import { registerTelegramBot, handleTelegramWebhook } from './channels/telegram.ts';
import { initServerKeyPair, getServerPublicKey } from './crypto.ts';
import { initKv } from './kv.ts';
import { RateLimiter, RATE_LIMITS } from './rate-limit.ts';
import { sanitizeMessage } from './sanitize.ts';
import { logger, requestLog } from './logger.ts';
import { addConnection, removeConnection } from './ws.ts';
import type { ChannelConfig } from '@chaos/shared';

const PORT = parseInt(Deno.env.get('PORT') || '8787');
const VERSION = '0.1.0';

// Lazy initialization — runs once on first request, not during module warmup
let initialized = false;
async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  initialized = true;
  await initKv();
  await initServerKeyPair();
  startMessageCleanup();
}

// Rate limiter instance
const rateLimiter = new RateLimiter();

// CORS headers for cross-origin requests from the extension
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Timestamp, X-Nonce, X-Signature',
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

function getClientIP(req: Request): string {
  // Check common proxy headers
  return req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || req.headers.get('X-Real-IP')
    || 'unknown';
}

// On Deno Deploy, port is managed by the platform; locally use PORT env
const serveOptions = Deno.env.get('DENO_DEPLOYMENT_ID') ? {} : { port: PORT };

Deno.serve(serveOptions, async (req: Request) => {
  // Lazy init on first request (avoids blocking Deno Deploy warmup)
  await ensureInitialized();

  const url = new URL(req.url);
  const method = req.method;
  const reqData = requestLog(req, 'server', 'request');

  // Log every incoming request
  logger.info('server', 'Incoming request', reqData);

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // ── Public endpoints (no auth) ──

  // Health check / status page
  if (url.pathname === '/health' && method === 'GET') {
    const { isKvAvailable } = await import('./kv.ts');
    const { getConnectionCount } = await import('./ws.ts');
    return json({
      status: 'ok',
      version: VERSION,
      kv: isKvAvailable(),
      websockets: getConnectionCount(),
      uptime: Math.floor(performance.now() / 1000),
    });
  }

  // Admin status page (protected by CHAOS_ADMIN_KEY env var)
  if (url.pathname === '/admin/status' && method === 'GET') {
    const adminKey = Deno.env.get('CHAOS_ADMIN_KEY');
    const providedKey = url.searchParams.get('key') || req.headers.get('X-Admin-Key');
    if (!adminKey || providedKey !== adminKey) {
      return error('Unauthorized', 401);
    }

    const { isKvAvailable, getKv } = await import('./kv.ts');
    const { getConnectionCount } = await import('./ws.ts');

    // List all sessions from KV
    const sessions: Array<{ userId: string; channels: number; createdAt: string }> = [];
    if (isKvAvailable() && getKv()) {
      const iter = getKv()!.list<UserSession>({ prefix: ['sessions'] });
      for await (const entry of iter) {
        const s = entry.value;
        sessions.push({
          userId: s.userId,
          channels: s.channels.length,
          createdAt: s.createdAt,
        });
      }
    }

    return json({
      status: 'ok',
      version: VERSION,
      kv: isKvAvailable(),
      websockets: getConnectionCount(),
      uptime: Math.floor(performance.now() / 1000),
      sessions,
    });
  }

  // Auth registration
  if (url.pathname === '/auth/register' && method === 'POST') {
    // Rate limit: 5/hour per IP
    const ip = getClientIP(req);
    if (!rateLimiter.check(`register:${ip}`, RATE_LIMITS.register.limit, RATE_LIMITS.register.windowMs)) {
      logger.warn('server', 'Rate limit hit for registration', { ip });
      return error('Too many registration attempts. Try again later.', 429);
    }

    let publicKey: JsonWebKey | undefined;
    try {
      const body = await req.json();
      if (body.publicKey) {
        publicKey = body.publicKey;
      }
    } catch {
      // No body or invalid JSON — that's fine, publicKey is optional for backwards compat
    }

    const session = await createSession(publicKey);
    const serverPublicKey = getServerPublicKey();

    logger.info('server', 'New session registered', { userId: session.userId, hasPublicKey: !!publicKey });

    return json({
      userId: session.userId,
      apiKey: session.apiKey,
      serverPublicKey,
    });
  }

  // Webhook ingestion (auth via URL token, not Bearer)
  const webhookMatch = url.pathname.match(/^\/webhook\/([^/]+)$/);
  if (webhookMatch && method === 'POST') {
    const channelId = webhookMatch[1];

    // Rate limit: 60/min per channel
    if (!rateLimiter.check(`webhook:${channelId}`, RATE_LIMITS.webhook.limit, RATE_LIMITS.webhook.windowMs)) {
      logger.warn('server', 'Rate limit hit for webhook', { channelId });
      return error('Too many webhook requests. Try again later.', 429);
    }

    const resp = await handleWebhook(channelId, req);
    // Add CORS headers to webhook responses too
    const body = await resp.text();
    logger.info('server', 'Webhook response', { channelId, status: resp.status });
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
    logger.info('server', 'Responses polled', { channelId, count: responses.length });
    return json({ responses, since: new Date().toISOString() });
  }

  // Telegram webhook ingestion (auth via URL secret, not Bearer)
  const telegramMatch = url.pathname.match(/^\/telegram\/([^/]+)$/);
  if (telegramMatch && method === 'POST') {
    const channelId = telegramMatch[1];

    // Rate limit: 60/min per channel (same as webhooks)
    if (!rateLimiter.check(`webhook:${channelId}`, RATE_LIMITS.webhook.limit, RATE_LIMITS.webhook.windowMs)) {
      logger.warn('server', 'Rate limit hit for Telegram webhook', { channelId });
      return error('Too many webhook requests. Try again later.', 429);
    }

    const resp = await handleTelegramWebhook(channelId, req);
    const body = await resp.text();
    logger.info('server', 'Telegram webhook response', { channelId, status: resp.status });
    return new Response(body, {
      status: resp.status,
      headers: { ...Object.fromEntries(resp.headers.entries()), ...corsHeaders },
    });
  }

  // ── WebSocket upgrade ──

  if (url.pathname === '/ws' && req.headers.get('upgrade') === 'websocket') {
    const token = url.searchParams.get('token');
    if (!token) {
      return error('Missing token query parameter', 401);
    }

    const wsSession = await getSessionByApiKey(token);
    if (!wsSession) {
      return error('Invalid token', 401);
    }

    const { socket, response } = Deno.upgradeWebSocket(req);
    const wsUserId = wsSession.userId;

    socket.onopen = () => {
      addConnection(wsUserId, socket);
      logger.info('server', 'WebSocket connected', { userId: wsUserId });
    };

    socket.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'reply') {
          const payload: ReplyPayload = {
            channelType: data.channelType,
            channelId: data.channelId,
            replyTo: data.replyTo,
            content: data.content,
            metadata: data.metadata,
          };
          if (!payload.channelId || !payload.content) {
            socket.send(JSON.stringify({ type: 'error', error: 'Missing channelId or content' }));
            return;
          }
          const sanitized = sanitizeMessage(payload.content);
          if (!sanitized.valid) {
            socket.send(JSON.stringify({ type: 'error', error: sanitized.error || 'Invalid message content' }));
            return;
          }
          payload.content = sanitized.content;
          const result = handleReply(wsUserId, payload);
          socket.send(JSON.stringify({ type: 'reply_ack', ...result }));
        } else if (data.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {
        socket.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
      }
    };

    socket.onclose = () => {
      removeConnection(wsUserId, socket);
      logger.info('server', 'WebSocket disconnected', { userId: wsUserId });
    };

    socket.onerror = (err: Event | ErrorEvent) => {
      const msg = (err as ErrorEvent).message || (err as ErrorEvent).error || err.type || 'unknown';
      logger.error('server', 'WebSocket error', { userId: wsUserId, error: String(msg) });
      removeConnection(wsUserId, socket);
    };

    return response;
  }

  // ── Authenticated endpoints ──

  const authResult = await validateAuth(req);
  if (!authResult) {
    logger.warn('server', 'Unauthorized request', reqData);
    return error('Unauthorized. Include Authorization: Bearer <apiKey>', 401);
  }

  const { session } = authResult;

  // Poll for messages
  if (url.pathname === '/messages' && method === 'GET') {
    // Rate limit: 120/min per user
    if (!rateLimiter.check(`messages:${session.userId}`, RATE_LIMITS.messages.limit, RATE_LIMITS.messages.windowMs)) {
      logger.warn('server', 'Rate limit hit for messages poll', { userId: session.userId });
      return error('Too many poll requests. Try again later.', 429);
    }

    const since = url.searchParams.get('since') || undefined;
    const messages = getMessages(session.userId, since);
    logger.info('server', 'Messages polled', { userId: session.userId, count: messages.length });
    return json({ messages, since: new Date().toISOString() });
  }

  // Send a reply
  if (url.pathname === '/reply' && method === 'POST') {
    // Rate limit: 30/min per user
    if (!rateLimiter.check(`reply:${session.userId}`, RATE_LIMITS.reply.limit, RATE_LIMITS.reply.windowMs)) {
      logger.warn('server', 'Rate limit hit for reply', { userId: session.userId });
      return error('Too many reply requests. Try again later.', 429);
    }

    try {
      const payload: ReplyPayload = await req.json();
      if (!payload.channelId || !payload.content) {
        logger.warn('server', 'Reply missing required fields', { userId: session.userId });
        return error('Missing channelId or content');
      }

      // Sanitize reply content
      const sanitized = sanitizeMessage(payload.content);
      if (!sanitized.valid) {
        logger.warn('server', 'Reply content failed sanitization', { userId: session.userId });
        return error(sanitized.error || 'Invalid message content');
      }
      payload.content = sanitized.content;

      const result = handleReply(session.userId, payload);
      logger.info('server', 'Reply sent', { userId: session.userId, channelId: payload.channelId, channelType: payload.channelType });
      return json(result);
    } catch {
      return error('Invalid JSON body');
    }
  }

  // Register a Telegram bot channel
  if (url.pathname === '/channels/telegram/register' && method === 'POST') {
    // Rate limit: 10/hour per user (same as channels)
    if (!rateLimiter.check(`channels:${session.userId}`, RATE_LIMITS.channels.limit, RATE_LIMITS.channels.windowMs)) {
      logger.warn('server', 'Rate limit hit for Telegram channel registration', { userId: session.userId });
      return error('Too many channel registration requests. Try again later.', 429);
    }

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

      // Encrypt the bot token before storing
      const { encryptToken } = await import('./crypto.ts');
      const encryptedToken = await encryptToken(botToken);

      const channel: ChannelConfig = {
        id: channelId,
        type: 'telegram',
        agentId: body.agentId || '',
        enabled: true,
        metadata: {
          botToken: encryptedToken,  // Encrypted at rest
          botTokenPlain: botToken,   // Kept in memory only, not persisted
          botUsername,
          webhookSecret,
        },
      };

      await addChannel(session.userId, channel);

      logger.info('server', 'Telegram bot channel registered', { userId: session.userId, channelId, botUsername });
      return json({ channelId, botUsername }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('server', 'Telegram registration failed', { userId: session.userId, error: message });
      return error(`Telegram registration failed: ${message}`);
    }
  }

  // Register a channel
  if (url.pathname === '/channels' && method === 'POST') {
    // Rate limit: 10/hour per user
    if (!rateLimiter.check(`channels:${session.userId}`, RATE_LIMITS.channels.limit, RATE_LIMITS.channels.windowMs)) {
      logger.warn('server', 'Rate limit hit for channel registration', { userId: session.userId });
      return error('Too many channel registration requests. Try again later.', 429);
    }

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

      await addChannel(session.userId, channel);

      // Build the webhook URL for the user
      const webhookUrl = channel.type === 'webhook'
        ? `${url.origin}/webhook/${channel.id}?token=${channel.metadata['webhookSecret']}`
        : undefined;

      logger.info('server', 'Channel registered', { userId: session.userId, channelId: channel.id, type: channel.type });
      return json({ channel, webhookUrl }, 201);
    } catch {
      return error('Invalid JSON body');
    }
  }

  // List channels
  if (url.pathname === '/channels' && method === 'GET') {
    const channels = await getChannels(session.userId);
    logger.info('server', 'Channels listed', { userId: session.userId, count: channels.length });
    return json({ channels });
  }

  // Delete a channel
  const channelDeleteMatch = url.pathname.match(/^\/channels\/([^/]+)$/);
  if (channelDeleteMatch && method === 'DELETE') {
    const channelId = channelDeleteMatch[1];
    const removed = await removeChannel(session.userId, channelId);
    if (!removed) {
      logger.warn('server', 'Channel not found for deletion', { userId: session.userId, channelId });
      return error('Channel not found', 404);
    }
    logger.info('server', 'Channel deleted', { userId: session.userId, channelId });
    return json({ ok: true });
  }

  logger.warn('server', 'Route not found', reqData);
  return error('Not found', 404);
});

logger.info('server', 'CHAOS relay server started', { port: PORT, version: VERSION });
