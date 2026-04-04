// CHAOS Relay Server
// Handles message relay between external channels and the Chrome extension

import {
  addChannel,
  createSession,
  getChannels,
  getSessionByApiKey,
  removeChannel,
  type UserSession,
  validateAuth,
} from "./auth.ts";
import {
  getMessages,
  getResponses,
  startMessageCleanup,
  type StoredMessage,
} from "./store.ts";
import { handleWebhook } from "./channels/webhook.ts";
import { handleReply, type ReplyPayload } from "./channels/responder.ts";
import {
  handleTelegramWebhook,
  registerTelegramBot,
} from "./channels/telegram.ts";
import { getServerPublicKey, initServerKeyPair } from "./crypto.ts";
import { getKv, initKv, isKvAvailable } from "./kv.ts";
import { RATE_LIMITS, RateLimiter } from "./rate-limit.ts";
import { sanitizeMessage } from "./sanitize.ts";
import { logger, requestLog } from "./logger.ts";
import { addConnection, getConnectionCount, removeConnection } from "./ws.ts";
import type { ChannelConfig } from "@chaos/shared";

const PORT = parseInt(Deno.env.get("PORT") || "8787");
const VERSION = "0.1.0";

/**
 * Watch KV for new messages and push them to a WebSocket.
 * Uses kv.watch() which works across Deno Deploy isolates.
 * On connection, first sends any messages since lastPollTimestamp to catch
 * messages that arrived between WS reconnects.
 */
async function startKvWatch(
  kv: Deno.Kv,
  userId: string,
  socket: WebSocket,
  signal: AbortSignal,
): Promise<void> {
  try {
    // First, send any messages that arrived while the client was disconnected
    // Use a short lookback window (5 minutes) to catch missed messages
    const lookback = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { getMessages } = await import("./store.ts");
    const missed = await getMessages(userId, lookback);
    if (missed.length > 0) {
      logger.info("server", "Sending missed messages on WS connect", {
        userId,
        count: missed.length,
      });
      for (const msg of missed) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "message", message: msg }));
        }
      }
    }

    // Now watch for new messages via KV watch
    logger.info("server", "Starting KV watch for user", { userId });
    const stream = kv.watch([["last_message", userId]]);
    const reader = stream.getReader();

    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) break;

      const entry = value[0];
      if (!entry.value) continue;

      const { messageId, timestamp } = entry.value as {
        messageId: string;
        timestamp: string;
      };

      logger.info("server", "KV watch triggered", {
        userId,
        messageId,
        timestamp,
      });

      // Fetch the actual message from KV and push it
      const result = await kv.get<StoredMessage>([
        "messages",
        userId,
        timestamp,
        messageId,
      ]);
      if (result.value && socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({ type: "message", message: result.value }),
        );
        logger.info("server", "KV watch pushed message via WS", {
          userId,
          messageId,
        });
      }
    }

    reader.releaseLock();
  } catch (err) {
    if (!signal.aborted) {
      logger.error("server", "KV watch error", {
        userId,
        error: String(err),
      });
    }
  }
}

// Lazy initialization — runs once on first request, not during module warmup
let initialized = false;
async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  initialized = true;
  await initKv();
  await initServerKeyPair();
  startMessageCleanup();
  logger.info("server", "Initialized", {
    kv: isKvAvailable(),
    wsConnections: getConnectionCount(),
    deploy: !!Deno.env.get("DENO_DEPLOYMENT_ID"),
  });
}

// Rate limiter instance
const rateLimiter = new RateLimiter();

// Admin session tokens — in-memory cache, KV is source of truth
const adminSessionCache = new Map<string, number>();

// CORS headers for cross-origin requests from the extension
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Timestamp, X-Nonce, X-Signature",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function getClientIP(req: Request): string {
  // Check common proxy headers
  return req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    req.headers.get("X-Real-IP") ||
    "unknown";
}

// On Deno Deploy, port is managed by the platform; locally use PORT env
const serveOptions = Deno.env.get("DENO_DEPLOYMENT_ID") ? {} : { port: PORT };

Deno.serve(serveOptions, async (req: Request) => {
  // Lazy init on first request (avoids blocking Deno Deploy warmup)
  await ensureInitialized();

  const url = new URL(req.url);
  const method = req.method;
  const reqData = requestLog(req, "server", "request");

  // Log every incoming request
  logger.info("server", "Incoming request", reqData);

  // Handle CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // ── Public endpoints (no auth) ──

  // Favicon
  if (url.pathname === "/favicon.ico") {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#238636"/><text x="16" y="22" text-anchor="middle" font-size="18" font-family="sans-serif" fill="white">C</text></svg>';
    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  // Health check / status page
  if (url.pathname === "/health" && method === "GET") {
    const { isKvAvailable } = await import("./kv.ts");
    const { getConnectionCount } = await import("./ws.ts");
    return json({
      status: "ok",
      version: VERSION,
      kv: isKvAvailable(),
      websockets: getConnectionCount(),
      uptime: Math.floor(performance.now() / 1000),
    });
  }

  // ── Admin dashboard (session cookie auth) ──

  const ADMIN_SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

  async function verifyAdminSession(req: Request): Promise<boolean> {
    const cookie = req.headers.get("cookie") || "";
    const match = cookie.match(/chaos_admin=([^;]+)/);
    if (!match) return false;
    const token = match[1];

    // Check in-memory cache first
    const cached = adminSessionCache.get(token);
    if (cached && Date.now() - cached < ADMIN_SESSION_TTL) return true;

    // Check KV
    if (isKvAvailable() && getKv()) {
      const result = await getKv()!.get<number>(["admin_sessions", token]);
      if (result.value && Date.now() - result.value < ADMIN_SESSION_TTL) {
        adminSessionCache.set(token, result.value);
        return true;
      }
    }

    adminSessionCache.delete(token);
    return false;
  }

  // Login page
  if (url.pathname === "/admin/login" && method === "GET") {
    const adminKey = Deno.env.get("CHAOS_ADMIN_KEY");
    if (!adminKey) {
      return error("Admin not configured (set CHAOS_ADMIN_KEY env var)", 503);
    }
    return new Response(ADMIN_LOGIN_HTML, {
      headers: { "Content-Type": "text/html", ...corsHeaders },
    });
  }

  // Login POST
  if (url.pathname === "/admin/login" && method === "POST") {
    const adminKey = Deno.env.get("CHAOS_ADMIN_KEY");
    if (!adminKey) return error("Admin not configured", 503);
    try {
      const body = await req.json();
      if (body.password !== adminKey) {
        return new Response(JSON.stringify({ error: "Invalid password" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      const token = crypto.randomUUID();
      const now = Date.now();
      adminSessionCache.set(token, now);
      if (isKvAvailable() && getKv()) {
        await getKv()!.set(["admin_sessions", token], now, {
          expireIn: ADMIN_SESSION_TTL,
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie":
            `chaos_admin=${token}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=86400`,
          ...corsHeaders,
        },
      });
    } catch {
      return error("Invalid request body");
    }
  }

  // Admin dashboard page
  if (url.pathname === "/admin" && method === "GET") {
    if (!(await verifyAdminSession(req))) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/admin/login" },
      });
    }
    return new Response(ADMIN_DASHBOARD_HTML, {
      headers: { "Content-Type": "text/html", ...corsHeaders },
    });
  }

  // Admin status API (used by dashboard JS)
  if (url.pathname === "/admin/status" && method === "GET") {
    if (!(await verifyAdminSession(req))) return error("Unauthorized", 401);

    const { isKvAvailable, getKv } = await import("./kv.ts");
    const { getConnectionCount } = await import("./ws.ts");
    const { getAllRecentMessages } = await import("./store.ts");

    interface AdminChannel {
      id: string;
      type: string;
      agentId: string;
      enabled: boolean;
      botUsername?: string;
      allowedUsers?: string[];
      hasPairingCode: boolean;
    }

    const sessions: Array<{
      userId: string;
      channels: AdminChannel[];
      createdAt: string;
      wsConnections: number;
    }> = [];

    if (isKvAvailable() && getKv()) {
      const iter = getKv()!.list<UserSession>({ prefix: ["sessions"] });
      for await (const entry of iter) {
        const s = entry.value;
        sessions.push({
          userId: s.userId,
          channels: s.channels.map((ch) => ({
            id: ch.id,
            type: ch.type,
            agentId: ch.agentId || "(default)",
            enabled: ch.enabled,
            botUsername: ch.metadata["botUsername"] as string | undefined,
            allowedUsers: ch.metadata["allowedUsers"] as string[] | undefined,
            hasPairingCode: !!ch.metadata["pairingCode"],
          })),
          createdAt: s.createdAt,
          wsConnections: getConnectionCount(s.userId),
        });
      }
    }

    // Get recent messages from KV (durable across restarts)
    const allMsgs = await getAllRecentMessages(30);
    const recentMessages = allMsgs.map((m) => ({
      id: m.id,
      userId: m.userId.slice(0, 8),
      channelType: m.channelType,
      channelId: m.channelId.slice(0, 8),
      from: m.from,
      direction: m.from === "agent" ? "out" : "in",
      content: m.content.slice(0, 100) + (m.content.length > 100 ? "..." : ""),
      timestamp: m.timestamp,
    }));

    return json({
      status: "ok",
      version: VERSION,
      kv: isKvAvailable(),
      websockets: getConnectionCount(),
      uptime: Math.floor(performance.now() / 1000),
      sessions,
      recentMessages,
    });
  }

  // Admin: delete a session
  if (url.pathname.startsWith("/admin/sessions/") && method === "DELETE") {
    if (!(await verifyAdminSession(req))) return error("Unauthorized", 401);
    const targetUserId = url.pathname.split("/").pop()!;
    const { isKvAvailable: kvOk, getKv } = await import("./kv.ts");
    if (kvOk() && getKv()) {
      // Find and delete the session by userId
      const iter = getKv()!.list<UserSession>({ prefix: ["sessions"] });
      for await (const entry of iter) {
        if (entry.value.userId === targetUserId) {
          await getKv()!.delete(entry.key);
          await getKv()!.delete(["users", targetUserId]);
          for (const ch of entry.value.channels) {
            await getKv()!.delete(["channels", ch.id]);
          }
          logger.info("admin", "Session deleted", { userId: targetUserId });
          return json({ ok: true, deleted: targetUserId });
        }
      }
    }
    return error("Session not found", 404);
  }

  // Admin logout
  if (url.pathname === "/admin/logout" && method === "POST") {
    const cookie = req.headers.get("cookie") || "";
    const match = cookie.match(/chaos_admin=([^;]+)/);
    if (match) {
      adminSessionCache.delete(match[1]);
      if (isKvAvailable() && getKv()) {
        await getKv()!.delete(["admin_sessions", match[1]]);
      }
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/admin/login",
        "Set-Cookie": "chaos_admin=; Path=/admin; HttpOnly; Max-Age=0",
      },
    });
  }

  // Auth registration
  if (url.pathname === "/auth/register" && method === "POST") {
    // Rate limit: 5/hour per IP
    const ip = getClientIP(req);
    if (
      !rateLimiter.check(
        `register:${ip}`,
        RATE_LIMITS.register.limit,
        RATE_LIMITS.register.windowMs,
      )
    ) {
      logger.warn("server", "Rate limit hit for registration", { ip });
      return error("Too many registration attempts. Try again later.", 429);
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

    logger.info("server", "New session registered", {
      userId: session.userId,
      hasPublicKey: !!publicKey,
    });

    return json({
      userId: session.userId,
      apiKey: session.apiKey,
      serverPublicKey,
    });
  }

  // Webhook ingestion (auth via URL token, not Bearer)
  const webhookMatch = url.pathname.match(/^\/webhook\/([^/]+)$/);
  if (webhookMatch && method === "POST") {
    const channelId = webhookMatch[1];

    // Rate limit: 60/min per channel
    if (
      !rateLimiter.check(
        `webhook:${channelId}`,
        RATE_LIMITS.webhook.limit,
        RATE_LIMITS.webhook.windowMs,
      )
    ) {
      logger.warn("server", "Rate limit hit for webhook", { channelId });
      return error("Too many webhook requests. Try again later.", 429);
    }

    const resp = await handleWebhook(channelId, req);
    // Add CORS headers to webhook responses too
    const body = await resp.text();
    logger.info("server", "Webhook response", {
      channelId,
      status: resp.status,
    });
    return new Response(body, {
      status: resp.status,
      headers: {
        ...Object.fromEntries(resp.headers.entries()),
        ...corsHeaders,
      },
    });
  }

  // Responses endpoint (for external services to poll for agent replies)
  const responsesMatch = url.pathname.match(/^\/responses\/([^/]+)$/);
  if (responsesMatch && method === "GET") {
    const channelId = responsesMatch[1];
    const since = url.searchParams.get("since") || undefined;
    const responses = await getResponses(channelId, since);
    logger.info("server", "Responses polled", {
      channelId,
      count: responses.length,
    });
    return json({ responses, since: new Date().toISOString() });
  }

  // Telegram webhook ingestion (auth via URL secret, not Bearer)
  const telegramMatch = url.pathname.match(/^\/telegram\/([^/]+)$/);
  if (telegramMatch && method === "POST") {
    const channelId = telegramMatch[1];

    // Rate limit: 60/min per channel (same as webhooks)
    if (
      !rateLimiter.check(
        `webhook:${channelId}`,
        RATE_LIMITS.webhook.limit,
        RATE_LIMITS.webhook.windowMs,
      )
    ) {
      logger.warn("server", "Rate limit hit for Telegram webhook", {
        channelId,
      });
      return error("Too many webhook requests. Try again later.", 429);
    }

    const resp = await handleTelegramWebhook(channelId, req);
    const body = await resp.text();
    logger.info("server", "Telegram webhook response", {
      channelId,
      status: resp.status,
    });
    return new Response(body, {
      status: resp.status,
      headers: {
        ...Object.fromEntries(resp.headers.entries()),
        ...corsHeaders,
      },
    });
  }

  // ── WebSocket upgrade ──

  if (url.pathname === "/ws" && req.headers.get("upgrade") === "websocket") {
    const token = url.searchParams.get("token");
    if (!token) {
      return error("Missing token query parameter", 401);
    }

    const wsSession = await getSessionByApiKey(token);
    if (!wsSession) {
      return error("Invalid token", 401);
    }

    const { socket, response } = Deno.upgradeWebSocket(req);
    const wsUserId = wsSession.userId;

    // Track the KV watch abort controller so we can stop it on close
    let watchController: AbortController | null = null;

    socket.onopen = () => {
      addConnection(wsUserId, socket);
      logger.info("server", "WebSocket connected", { userId: wsUserId });

      // Start watching KV for new messages (works across isolates on Deno Deploy)
      if (isKvAvailable() && getKv()) {
        watchController = new AbortController();
        startKvWatch(getKv()!, wsUserId, socket, watchController.signal);
      }
    };

    socket.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "reply") {
          const payload: ReplyPayload = {
            channelType: data.channelType,
            channelId: data.channelId,
            replyTo: data.replyTo,
            content: data.content,
            metadata: data.metadata,
          };
          if (!payload.channelId || !payload.content) {
            socket.send(
              JSON.stringify({
                type: "error",
                error: "Missing channelId or content",
              }),
            );
            return;
          }
          const sanitized = sanitizeMessage(payload.content);
          if (!sanitized.valid) {
            socket.send(
              JSON.stringify({
                type: "error",
                error: sanitized.error || "Invalid message content",
              }),
            );
            return;
          }
          payload.content = sanitized.content;
          const result = await handleReply(wsUserId, payload);
          socket.send(JSON.stringify({ type: "reply_ack", ...result }));
        } else if (data.type === "ping") {
          socket.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        socket.send(JSON.stringify({ type: "error", error: "Invalid JSON" }));
      }
    };

    socket.onclose = () => {
      watchController?.abort();
      removeConnection(wsUserId, socket);
      logger.info("server", "WebSocket disconnected", { userId: wsUserId });
    };

    socket.onerror = (err: Event | ErrorEvent) => {
      const msg = (err as ErrorEvent).message || (err as ErrorEvent).error ||
        err.type || "unknown";
      logger.error("server", "WebSocket error", {
        userId: wsUserId,
        error: String(msg),
      });
      watchController?.abort();
      removeConnection(wsUserId, socket);
    };

    return response;
  }

  // ── Authenticated endpoints ──

  const authResult = await validateAuth(req);
  if (!authResult) {
    logger.warn("server", "Unauthorized request", reqData);
    return error("Unauthorized. Include Authorization: Bearer <apiKey>", 401);
  }

  const { session } = authResult;

  // Poll for messages
  if (url.pathname === "/messages" && method === "GET") {
    // Rate limit: 120/min per user
    if (
      !rateLimiter.check(
        `messages:${session.userId}`,
        RATE_LIMITS.messages.limit,
        RATE_LIMITS.messages.windowMs,
      )
    ) {
      logger.warn("server", "Rate limit hit for messages poll", {
        userId: session.userId,
      });
      return error("Too many poll requests. Try again later.", 429);
    }

    const since = url.searchParams.get("since") || undefined;
    const messages = await getMessages(session.userId, since);
    logger.info("server", "Messages polled", {
      userId: session.userId,
      since: since || "(all)",
      count: messages.length,
      wsConnections: getConnectionCount(session.userId),
    });
    return json({ messages, since: new Date().toISOString() });
  }

  // Send a reply
  if (url.pathname === "/reply" && method === "POST") {
    // Rate limit: 30/min per user
    if (
      !rateLimiter.check(
        `reply:${session.userId}`,
        RATE_LIMITS.reply.limit,
        RATE_LIMITS.reply.windowMs,
      )
    ) {
      logger.warn("server", "Rate limit hit for reply", {
        userId: session.userId,
      });
      return error("Too many reply requests. Try again later.", 429);
    }

    try {
      const payload: ReplyPayload = await req.json();
      if (!payload.channelId || !payload.content) {
        logger.warn("server", "Reply missing required fields", {
          userId: session.userId,
        });
        return error("Missing channelId or content");
      }

      // Sanitize reply content
      const sanitized = sanitizeMessage(payload.content);
      if (!sanitized.valid) {
        logger.warn("server", "Reply content failed sanitization", {
          userId: session.userId,
        });
        return error(sanitized.error || "Invalid message content");
      }
      payload.content = sanitized.content;

      const result = await handleReply(session.userId, payload);
      logger.info("server", "Reply sent", {
        userId: session.userId,
        channelId: payload.channelId,
        channelType: payload.channelType,
      });
      return json(result);
    } catch {
      return error("Invalid JSON body");
    }
  }

  // Register a Telegram bot channel
  if (url.pathname === "/channels/telegram/register" && method === "POST") {
    // Rate limit: 10/hour per user (same as channels)
    if (
      !rateLimiter.check(
        `channels:${session.userId}`,
        RATE_LIMITS.channels.limit,
        RATE_LIMITS.channels.windowMs,
      )
    ) {
      logger.warn(
        "server",
        "Rate limit hit for Telegram channel registration",
        { userId: session.userId },
      );
      return error(
        "Too many channel registration requests. Try again later.",
        429,
      );
    }

    try {
      const body = await req.json();
      const botToken = body.botToken;
      if (!botToken || typeof botToken !== "string") {
        return error("Missing or invalid botToken");
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
      const { encryptToken } = await import("./crypto.ts");
      const encryptedToken = await encryptToken(botToken);

      // Generate a pairing code for the owner to send to the bot
      const pairingCode = crypto.randomUUID().slice(0, 8).toUpperCase();

      const channel: ChannelConfig = {
        id: channelId,
        type: "telegram",
        agentId: body.agentId || "",
        enabled: true,
        metadata: {
          botToken: encryptedToken, // Encrypted at rest
          botTokenPlain: botToken, // Kept in memory only, not persisted
          botUsername,
          webhookSecret,
          pairingCode,
        },
      };

      await addChannel(session.userId, channel);

      logger.info("server", "Telegram bot channel registered", {
        userId: session.userId,
        channelId,
        botUsername,
        pairingCode,
      });
      return json({ channelId, botUsername, pairingCode }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("server", "Telegram registration failed", {
        userId: session.userId,
        error: message,
      });
      return error(`Telegram registration failed: ${message}`);
    }
  }

  // Register a channel
  if (url.pathname === "/channels" && method === "POST") {
    // Rate limit: 10/hour per user
    if (
      !rateLimiter.check(
        `channels:${session.userId}`,
        RATE_LIMITS.channels.limit,
        RATE_LIMITS.channels.windowMs,
      )
    ) {
      logger.warn("server", "Rate limit hit for channel registration", {
        userId: session.userId,
      });
      return error(
        "Too many channel registration requests. Try again later.",
        429,
      );
    }

    try {
      const body = await req.json();
      const channel: ChannelConfig = {
        id: body.id || crypto.randomUUID(),
        type: body.type || "webhook",
        agentId: body.agentId || "",
        enabled: body.enabled !== false,
        metadata: body.metadata || {},
      };

      // For webhook channels, generate a secret token
      if (channel.type === "webhook" && !channel.metadata["webhookSecret"]) {
        channel.metadata["webhookSecret"] = crypto.randomUUID();
      }

      await addChannel(session.userId, channel);

      // Build the webhook URL for the user
      const webhookUrl = channel.type === "webhook"
        ? `${url.origin}/webhook/${channel.id}?token=${
          channel.metadata["webhookSecret"]
        }`
        : undefined;

      logger.info("server", "Channel registered", {
        userId: session.userId,
        channelId: channel.id,
        type: channel.type,
      });
      return json({ channel, webhookUrl }, 201);
    } catch {
      return error("Invalid JSON body");
    }
  }

  // List channels
  if (url.pathname === "/channels" && method === "GET") {
    const channels = await getChannels(session.userId);
    logger.info("server", "Channels listed", {
      userId: session.userId,
      count: channels.length,
    });
    return json({ channels });
  }

  // Update channel metadata (e.g. allowlist)
  const channelPatchMatch = url.pathname.match(/^\/channels\/([^/]+)$/);
  if (channelPatchMatch && method === "PATCH") {
    try {
      const channelId = channelPatchMatch[1];
      const body = await req.json();
      const channels = await getChannels(session.userId);
      const channel = channels.find((ch) => ch.id === channelId);
      if (!channel) {
        return error("Channel not found", 404);
      }
      // Merge metadata updates (only allow safe fields)
      if (body.metadata) {
        if (Array.isArray(body.metadata.allowedUsers)) {
          channel.metadata["allowedUsers"] = body.metadata.allowedUsers.map(
            String,
          );
        }
      }
      // Persist the updated channel by re-adding it
      await removeChannel(session.userId, channelId);
      await addChannel(session.userId, channel);
      logger.info("server", "Channel updated", {
        userId: session.userId,
        channelId,
        allowedUsers: channel.metadata["allowedUsers"],
      });
      return json({ ok: true, channel });
    } catch {
      return error("Invalid JSON body");
    }
  }

  // Delete a channel
  const channelDeleteMatch = url.pathname.match(/^\/channels\/([^/]+)$/);
  if (channelDeleteMatch && method === "DELETE") {
    const channelId = channelDeleteMatch[1];
    const removed = await removeChannel(session.userId, channelId);
    if (!removed) {
      logger.warn("server", "Channel not found for deletion", {
        userId: session.userId,
        channelId,
      });
      return error("Channel not found", 404);
    }
    logger.info("server", "Channel deleted", {
      userId: session.userId,
      channelId,
    });
    return json({ ok: true });
  }

  logger.warn("server", "Route not found", reqData);
  return error("Not found", 404);
});

logger.info("server", "CHAOS relay server started", {
  port: PORT,
  version: VERSION,
});

// ── Admin HTML templates ──

const ADMIN_LOGIN_HTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CHAOS Admin - Login</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#0f1117;color:#e1e4e8;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:32px;width:100%;max-width:360px}
  h1{font-size:18px;margin-bottom:16px;color:#f0f3f6}
  input{width:100%;padding:8px 12px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e1e4e8;font-size:14px;margin-bottom:12px}
  input:focus{outline:none;border-color:#58a6ff}
  button{width:100%;padding:8px 12px;background:#238636;border:none;border-radius:6px;color:#fff;font-size:14px;cursor:pointer;font-weight:500}
  button:hover{background:#2ea043}
  .error{color:#f85149;font-size:12px;margin-bottom:8px;display:none}
</style></head><body>
<div class="card">
  <h1>CHAOS Relay Admin</h1>
  <div class="error" id="err"></div>
  <form id="f">
    <input type="password" id="pw" placeholder="Admin password" autofocus>
    <button type="submit">Log in</button>
  </form>
</div>
<script>
document.getElementById('f').onsubmit=async e=>{
  e.preventDefault();
  const pw=document.getElementById('pw').value;
  const r=await fetch('/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})});
  if(r.ok){location.href='/admin'}
  else{const d=await r.json().catch(()=>({}));const el=document.getElementById('err');el.textContent=d.error||'Login failed';el.style.display='block'}
};
</script></body></html>`;

const ADMIN_DASHBOARD_HTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CHAOS Admin Dashboard</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#0f1117;color:#e1e4e8;padding:24px;max-width:1200px;margin:0 auto}
  h1{font-size:20px;margin-bottom:4px}
  .subtitle{color:#8b949e;font-size:13px;margin-bottom:24px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:24px}
  .stat{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
  .stat-value{font-size:24px;font-weight:600;color:#f0f3f6}
  .stat-label{font-size:11px;color:#8b949e;margin-top:4px;text-transform:uppercase;letter-spacing:0.5px}
  .stat-ok{color:#3fb950}.stat-warn{color:#d29922}.stat-err{color:#f85149}
  h2{font-size:16px;margin:24px 0 12px;color:#f0f3f6}
  .card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:12px}
  .card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
  .card-title{font-size:14px;font-weight:600;color:#f0f3f6}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{text-align:left;padding:6px 10px;border-bottom:1px solid #30363d;color:#8b949e;font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:0.3px}
  td{padding:6px 10px;border-bottom:1px solid #21262d;vertical-align:top}
  .badge{display:inline-block;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:500;margin-right:4px}
  .badge-telegram{background:#2b5278;color:#7bc8f6}
  .badge-webhook{background:#2d3a2d;color:#7ee787}
  .badge-in{background:#1f3a1f;color:#7ee787}
  .badge-out{background:#3a1f1f;color:#f0883e}
  .badge-paired{background:#1a3a1a;color:#3fb950}
  .badge-pending{background:#3a3a1a;color:#d29922}
  .channel-detail{font-size:11px;color:#8b949e;margin-top:2px}
  .topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
  .btn-logout{background:none;border:1px solid #30363d;border-radius:6px;color:#8b949e;padding:4px 12px;cursor:pointer;font-size:12px}
  .btn-logout:hover{color:#f0f3f6;border-color:#8b949e}
  .btn-refresh{background:none;border:1px solid #30363d;border-radius:6px;color:#58a6ff;padding:4px 12px;cursor:pointer;font-size:12px;margin-right:8px}
  #status{font-size:11px;color:#8b949e}
  .msg-content{max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace;font-size:11px}
  .ts{font-size:11px;color:#8b949e;font-family:monospace}
  code{background:#21262d;padding:1px 4px;border-radius:3px;font-size:11px}
</style></head><body>
<div class="topbar">
  <div><h1>CHAOS Relay Admin</h1><div class="subtitle">Server dashboard — auto-refreshes every 10s</div></div>
  <div>
    <span id="status"></span>
    <button class="btn-refresh" onclick="load()">Refresh</button>
    <form action="/admin/logout" method="POST" style="display:inline"><button class="btn-logout" type="submit">Logout</button></form>
  </div>
</div>
<div class="grid" id="stats"></div>

<h2>Sessions &amp; Channels</h2>
<div id="sessions"></div>

<h2>Recent Messages</h2>
<table><thead><tr><th>Time</th><th>Dir</th><th>From</th><th>Channel</th><th>User</th><th>Content</th></tr></thead><tbody id="messages"></tbody></table>

<script>
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function ago(ts){const s=Math.floor((Date.now()-new Date(ts).getTime())/1000);if(s<60)return s+'s ago';if(s<3600)return Math.floor(s/60)+'m ago';return Math.floor(s/3600)+'h ago'}

async function load(){
  document.getElementById('status').textContent='Loading...';
  try{
    const r=await fetch('/admin/status');
    if(r.status===401){location.href='/admin/login';return}
    const d=await r.json();

    // Stats
    document.getElementById('stats').innerHTML=
      '<div class="stat"><div class="stat-value '+(d.kv?'stat-ok':'stat-err')+'">'+(d.kv?'Connected':'Offline')+'</div><div class="stat-label">Deno KV</div></div>'+
      '<div class="stat"><div class="stat-value">'+d.websockets+'</div><div class="stat-label">WebSockets</div></div>'+
      '<div class="stat"><div class="stat-value">'+d.sessions.length+'</div><div class="stat-label">Sessions</div></div>'+
      '<div class="stat"><div class="stat-value">'+Math.floor(d.uptime/60)+'m</div><div class="stat-label">Uptime</div></div>';

    // Sessions with channel details
    const sc=document.getElementById('sessions');
    sc.innerHTML=d.sessions.map(s=>{
      const wsStatus=s.wsConnections>0?'<span class="stat-ok">'+s.wsConnections+' connected</span>':'<span style="color:#8b949e">disconnected</span>';
      const channels=s.channels.length===0?'<div style="color:#8b949e;font-size:12px;padding:4px 0">No channels</div>':
        s.channels.map(ch=>{
          let detail='<code>'+esc(ch.id.slice(0,12))+'</code>';
          if(ch.type==='telegram'){
            detail+=' @'+esc(ch.botUsername||'?');
            if(ch.hasPairingCode) detail+=' <span class="badge badge-pending">awaiting pairing</span>';
            else if(ch.allowedUsers&&ch.allowedUsers.length>0) detail+=' <span class="badge badge-paired">'+ch.allowedUsers.length+' user(s)</span>';
            else detail+=' <span class="badge badge-pending">open (no allowlist)</span>';
          }else{
            detail+=' <span class="badge badge-webhook">webhook</span>';
          }
          return '<div style="padding:4px 0;font-size:12px"><span class="badge badge-'+esc(ch.type)+'">'+esc(ch.type)+'</span> '+detail+'</div>';
        }).join('');
      return '<div class="card"><div class="card-header"><span class="card-title"><code>'+esc(s.userId.slice(0,12))+'...</code></span><span>'+wsStatus+' <button onclick="delSession(&apos;'+esc(s.userId)+'&apos;)" style="background:none;border:1px solid #f85149;color:#f85149;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:10px;margin-left:8px">Delete</button></span></div>'+
        '<div class="channel-detail">Created: '+new Date(s.createdAt).toLocaleString()+' | ID: <code>'+esc(s.userId)+'</code></div>'+
        '<div style="margin-top:8px">'+channels+'</div></div>';
    }).join('')||'<div style="color:#8b949e">No sessions</div>';

    // Recent messages
    const mt=document.getElementById('messages');
    mt.innerHTML=(d.recentMessages||[]).map(m=>
      '<tr>'+
      '<td class="ts">'+ago(m.timestamp)+'</td>'+
      '<td><span class="badge badge-'+m.direction+'">'+m.direction+'</span></td>'+
      '<td>'+esc(m.from)+'</td>'+
      '<td><span class="badge badge-'+esc(m.channelType)+'">'+esc(m.channelType)+'</span> '+esc(m.channelId)+'</td>'+
      '<td><code>'+esc(m.userId)+'</code></td>'+
      '<td class="msg-content" title="'+esc(m.content)+'">'+esc(m.content)+'</td>'+
      '</tr>'
    ).join('')||'<tr><td colspan="6" style="color:#8b949e;text-align:center">No recent messages</td></tr>';

    document.getElementById('status').textContent='Updated '+new Date().toLocaleTimeString();
  }catch(e){
    document.getElementById('status').textContent='Error: '+e.message;
  }
}
load();
setInterval(load,10000);
async function delSession(userId){
  if(!confirm('Delete session '+userId.slice(0,12)+'...?'))return;
  const r=await fetch('/admin/sessions/'+userId,{method:'DELETE'});
  if(r.ok){load()}else{alert('Failed: '+(await r.json()).error)}
}
</script></body></html>`;
