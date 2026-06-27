// CHAOS Relay Server
// Handles message relay between external channels and the Chrome extension

import {
  addChannel,
  createSession,
  getChannels,
  getSessionByApiKey,
  getSessionByChannelId,
  removeChannel,
  updateChannelMetadata,
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
import {
  handleDiscordWebhook,
  registerDiscordBot,
} from "./channels/discord.ts";
import {
  handleEmailInbound,
  handleEmailVerification,
  registerEmailChannel,
} from "./channels/email.ts";
import { getServerPublicKey } from "./crypto.ts";
import { getKv, initKv, isKvAvailable, kvHealthCheck, kvStats } from "./kv.ts";
import { RATE_LIMITS, RateLimiter } from "./rate-limit.ts";
import { sanitizeMessage } from "./sanitize.ts";
import { logger, requestLog } from "./logger.ts";
import {
  addConnection,
  getConnectionCount,
  pushToUser,
  removeConnection,
  startConnectionReaper,
} from "./ws.ts";
import {
  handleMcpDelete,
  handleMcpGet,
  handleMcpPost,
  handleMcpResponse,
} from "./channels/mcp.ts";
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

    // When the socket closes the controller aborts, but the loop below is
    // parked inside `reader.read()` until the next watch event arrives. For a
    // quiet user that never happens, so the loop would never re-check
    // signal.aborted and this kv.watch() stream would leak — one leaked KV
    // Connect subscription per closed/reconnected socket. Enough of those
    // exhaust Deno Deploy's concurrent-watch cap and KV starts 500ing every
    // call (including the atomic writes that /auth/register depends on).
    // Cancelling the reader on abort wakes the parked read so the stream is
    // torn down immediately.
    const onAbort = () => {
      reader.cancel().catch(() => {});
    };
    signal.addEventListener("abort", onAbort, { once: true });

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

    signal.removeEventListener("abort", onAbort);
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
// ensureInitialized removed — KV inits eagerly at module load, keypair is lazy

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

// Start KV initialization eagerly at module load — just KV, nothing else
// Server keypair is lazy (loaded on first /register call)
const kvInitPromise = initKv().then(async () => {
  startMessageCleanup();
  startConnectionReaper();
  // Warm all caches from KV so admin dashboard has data immediately
  const { warmSessionCache } = await import("./auth.ts");
  const { warmMessageCache } = await import("./store.ts");
  await Promise.all([warmSessionCache(), warmMessageCache()]);
  initialized = true;
  logger.info("server", "Init complete", { kv: isKvAvailable() });
}).catch((err) => {
  initialized = true;
  logger.error("server", "Init failed, continuing without KV", {
    error: String(err),
  });
});

Deno.serve(serveOptions, async (req: Request) => {
  const reqStart = performance.now();
  const url = new URL(req.url);
  const method = req.method;

  // ── Fast path: serve static pages WITHOUT waiting for KV ──
  // These don't need KV — serve them instantly on cold start

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

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

  // Health check — instant by default (no KV round-trip), so it stays a
  // reliable liveness probe even while KV is wedged. Always includes the
  // rolling KV counters (kvStats) so a climbing error/timeout count or a
  // lastError is visible at a glance — that's the signal that was missing when
  // register silently hung. Add ?deep=1 to also do a live KV write+read probe.
  if (url.pathname === "/health" && method === "GET") {
    const deep = url.searchParams.get("deep") === "1";
    const live = deep ? await kvHealthCheck() : null;
    return json({
      status: live && !live.ok ? "degraded" : "ok",
      version: VERSION,
      kv: isKvAvailable(),
      kvStats: kvStats(),
      ...(live ? { kvLive: live } : {}),
      initialized,
      websockets: getConnectionCount(),
      uptime: Math.floor(performance.now() / 1000),
    });
  }

  // Admin login page — static HTML, no KV needed
  if (url.pathname === "/admin/login" && method === "GET") {
    const adminKey = Deno.env.get("CHAOS_ADMIN_KEY");
    if (!adminKey) {
      return error("Admin not configured (set CHAOS_ADMIN_KEY env var)", 503);
    }
    return new Response(adminLoginHtml(), {
      headers: { "Content-Type": "text/html", ...corsHeaders },
    });
  }

  // Admin dashboard HTML — serve immediately (JS fetches data after)
  if (url.pathname === "/admin" && method === "GET") {
    // Quick session check from in-memory cache (no KV hit)
    const cookie = req.headers.get("cookie") || "";
    const match = cookie.match(/chaos_admin=([^;]+)/);
    const token = match?.[1];
    const cached = token ? adminSessionCache.get(token) : undefined;
    const ADMIN_SESSION_TTL_CHECK = 24 * 60 * 60 * 1000;
    if (cached && Date.now() - cached < ADMIN_SESSION_TTL_CHECK) {
      // Valid cached session — serve dashboard HTML instantly
      return new Response(ADMIN_DASHBOARD_HTML, {
        headers: { "Content-Type": "text/html", ...corsHeaders },
      });
    }
    // No cached session — redirect to login (KV check happens on /admin/status)
    return new Response(null, {
      status: 302,
      headers: { Location: "/admin/login" },
    });
  }

  // ── Endpoints below may need KV ──
  const reqData = requestLog(req, "server", "request");
  logger.info("server", "Incoming request", reqData);

  // Wait for KV init if not ready (non-admin endpoints need it for auth)
  if (!initialized) {
    const initStart = performance.now();
    await kvInitPromise;
    logger.info("server", "Waited for init", {
      ...reqData,
      initMs: Math.round(performance.now() - initStart),
    });
  }

  // ── Admin dashboard (session cookie auth) ──

  const ADMIN_SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

  async function verifyAdminSession(req: Request): Promise<boolean> {
    const t = performance.now();
    const cookie = req.headers.get("cookie") || "";
    const match = cookie.match(/chaos_admin=([^;]+)/);
    if (!match) {
      logger.debug("admin", "No admin cookie found");
      return false;
    }
    const token = match[1];

    // Check in-memory cache first
    const cached = adminSessionCache.get(token);
    if (cached && Date.now() - cached < ADMIN_SESSION_TTL) {
      logger.debug("admin", "Session verified from cache", {
        ms: Math.round(performance.now() - t),
      });
      return true;
    }

    // Check KV
    if (isKvAvailable() && getKv()) {
      const result = await getKv()!.get<number>(["admin_sessions", token]);
      if (result.value && Date.now() - result.value < ADMIN_SESSION_TTL) {
        adminSessionCache.set(token, result.value);
        logger.info("admin", "Session verified from KV", {
          ms: Math.round(performance.now() - t),
        });
        return true;
      }
    }

    logger.warn("admin", "Session verification failed", {
      ms: Math.round(performance.now() - t),
    });
    adminSessionCache.delete(token);
    return false;
  }

  // Login POST — accepts form data (standard HTML form) or JSON
  if (url.pathname === "/admin/login" && method === "POST") {
    const adminKey = Deno.env.get("CHAOS_ADMIN_KEY");
    if (!adminKey) return error("Admin not configured", 503);
    try {
      // Parse password from form data or JSON
      let password: string | undefined;
      const contentType = req.headers.get("Content-Type") || "";
      if (contentType.includes("application/x-www-form-urlencoded")) {
        const formData = await req.formData();
        password = formData.get("password")?.toString();
      } else {
        const body = await req.json();
        password = body.password;
      }

      if (!password || password !== adminKey) {
        // For form submissions, redirect back with error
        if (contentType.includes("application/x-www-form-urlencoded")) {
          return new Response(adminLoginHtml("Invalid password"), {
            status: 401,
            headers: { "Content-Type": "text/html", ...corsHeaders },
          });
        }
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

      // For form submissions, redirect to dashboard with cookie set
      if (contentType.includes("application/x-www-form-urlencoded")) {
        return new Response(null, {
          status: 303,
          headers: {
            Location: "/admin",
            "Set-Cookie":
              `chaos_admin=${token}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=86400`,
            ...corsHeaders,
          },
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
    } catch (err) {
      logger.error("server", "Admin login error", { error: String(err) });
      return error("Invalid request body");
    }
  }

  // Admin dashboard page (HTML served above init gate, this is fallback for KV-based session check)
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
    // Quick session check from cache first (no KV)
    const statusCookie = req.headers.get("cookie") || "";
    const statusMatch = statusCookie.match(/chaos_admin=([^;]+)/);
    const statusToken = statusMatch?.[1];
    const statusCached = statusToken
      ? adminSessionCache.get(statusToken)
      : undefined;
    if (!(statusCached && Date.now() - statusCached < 24 * 60 * 60 * 1000)) {
      // Not in cache — need KV for verification
      if (!initialized) {
        // KV not ready — wait briefly, but don't block forever
        const raceResult = await Promise.race([
          kvInitPromise.then(() => "ready" as const),
          new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 3000)),
        ]);
        if (raceResult === "timeout") {
          // Return partial status instead of blocking
          return json({
            status: "initializing",
            version: VERSION,
            kv: false,
            kvInitializing: true,
            websockets: 0,
            uptime: Math.floor(performance.now() / 1000),
            sessions: [],
            recentMessages: [],
            queryMs: 0,
          });
        }
      }
      if (!(await verifyAdminSession(req))) return error("Unauthorized", 401);
    }

    // Use in-memory caches — NO KV scans. Instant.
    const { getCachedSessions } = await import("./auth.ts");
    const { getCachedRecentMessages } = await import("./store.ts");
    const { getConnectionCount } = await import("./ws.ts");

    const t0 = performance.now();

    const cachedSessions = getCachedSessions();
    const sessions = cachedSessions.map((s) => ({
      userId: s.userId,
      channels: s.channels.map((ch) => ({
        id: ch.id,
        type: ch.type,
        agentId: ch.agentId || "(default)",
        enabled: ch.enabled,
        botUsername: ch.metadata["botUsername"] as string | undefined,
        allowedUsers: ch.metadata["allowedUsers"] as string[] | undefined,
        allowedSenders: ch.metadata["allowedSenders"] as
          | string[]
          | undefined,
        inboundAddress: ch.metadata["inboundAddress"] as
          | string
          | undefined,
        verified: ch.metadata["verified"] as boolean | undefined,
        hasPairingCode: !!ch.metadata["pairingCode"],
      })),
      createdAt: s.createdAt,
      wsConnections: getConnectionCount(s.userId),
    }));

    const allMsgs = getCachedRecentMessages(30);

    const adminMs = Math.round(performance.now() - t0);
    logger.info("admin", "Status request complete (from cache)", {
      totalMs: adminMs,
      sessions: sessions.length,
      messages: allMsgs.length,
    });
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
      cached: true,
      queryMs: adminMs,
      websockets: getConnectionCount(),
      uptime: Math.floor(performance.now() / 1000),
      sessions,
      recentMessages,
    });
  }

  // Admin: get messages for a specific session
  if (
    url.pathname.match(/^\/admin\/sessions\/[^/]+\/messages$/) &&
    method === "GET"
  ) {
    if (!(await verifyAdminSession(req))) return error("Unauthorized", 401);
    const parts = url.pathname.split("/");
    const targetUserId = parts[3];
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") || "50"),
      200,
    );
    const cursor = url.searchParams.get("cursor") || undefined;
    try {
      const { getMessagesForUser } = await import("./store.ts");
      const result = await getMessagesForUser(targetUserId, limit, cursor);
      return json(result);
    } catch (err) {
      logger.error("admin", "Failed to fetch session messages", {
        userId: targetUserId,
        error: String(err),
      });
      return json({ messages: [], error: String(err) });
    }
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
            await getKv()!.delete(["reply_target", ch.id]);
          }
          // The admin dashboard reads only the in-memory caches, so evict there
          // too — otherwise the deleted session reappears on the next refresh.
          const { evictSessionFromCache } = await import("./auth.ts");
          evictSessionFromCache(targetUserId);
          logger.info("admin", "Session deleted", { userId: targetUserId });
          return json({ ok: true, deleted: targetUserId });
        }
      }
    }
    return error("Session not found", 404);
  }

  // Admin: KV browser — browse raw KV contents
  if (url.pathname === "/admin/kv" && method === "GET") {
    if (!(await verifyAdminSession(req))) return error("Unauthorized", 401);
    const { getKv, isKvAvailable: kvOk2 } = await import("./kv.ts");
    if (!kvOk2() || !getKv()) {
      return json({ error: "KV not available", entries: [] });
    }

    const prefix = url.searchParams.get("prefix") || "";
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") || "50"),
      200,
    );
    const prefixKey = prefix ? prefix.split(",") : [];

    const entries: Array<
      { key: string[]; value: unknown; versionstamp: string }
    > = [];
    const t = performance.now();
    const iter = getKv()!.list({ prefix: prefixKey as Deno.KvKey }, { limit });
    for await (const entry of iter) {
      entries.push({
        key: entry.key.map(String),
        value: entry.value,
        versionstamp: entry.versionstamp,
      });
    }
    const ms = Math.round(performance.now() - t);
    logger.info("admin", "KV browse", { prefix, entries: entries.length, ms });
    return json({ prefix: prefixKey, entries, count: entries.length, ms });
  }

  // Admin: list KV prefixes (top-level keys overview)
  if (url.pathname === "/admin/kv/prefixes" && method === "GET") {
    if (!(await verifyAdminSession(req))) return error("Unauthorized", 401);
    const { getKv, isKvAvailable: kvOk3 } = await import("./kv.ts");
    if (!kvOk3() || !getKv()) {
      return json({ error: "KV not available", prefixes: [] });
    }

    const prefixes = new Map<string, number>();
    const t = performance.now();
    const iter = getKv()!.list({ prefix: [] }, { limit: 1000 });
    for await (const entry of iter) {
      const topKey = String(entry.key[0]);
      prefixes.set(topKey, (prefixes.get(topKey) || 0) + 1);
    }
    const ms = Math.round(performance.now() - t);
    const result = Array.from(prefixes.entries()).map(([prefix, count]) => ({
      prefix,
      count,
    }));
    return json({ prefixes: result, ms });
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

    let session: { userId: string; apiKey: string };
    let serverPublicKey: JsonWebKey | null;
    try {
      session = await createSession(publicKey);
      serverPublicKey = await getServerPublicKey();
    } catch (err) {
      // Almost always a KV failure (e.g. KvTimeoutError from a wedged KV
      // Connect). Fail fast and loud with a 503 instead of hanging — the
      // instrumented KV layer has already logged the op-level detail.
      logger.error("server", "Registration failed", {
        ip,
        hasPublicKey: !!publicKey,
        error: String(err),
      });
      return error(
        "Registration temporarily unavailable (storage error). Please retry.",
        503,
      );
    }

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

  // Email verification (no Bearer auth — user clicks link from email)
  if (url.pathname === "/email/verify" && method === "GET") {
    const token = url.searchParams.get("token");
    const channelId = url.searchParams.get("channelId");
    if (!token || !channelId) {
      return new Response("Missing token or channelId", {
        status: 400,
        headers: { "Content-Type": "text/plain", ...corsHeaders },
      });
    }

    const resp = await handleEmailVerification(
      token,
      channelId,
      getSessionByChannelId,
      updateChannelMetadata,
    );
    const body = await resp.text();
    return new Response(body, {
      status: resp.status,
      headers: {
        ...Object.fromEntries(resp.headers.entries()),
        ...corsHeaders,
      },
    });
  }

  // Email inbound — single webhook endpoint, routes by "to" address
  if (url.pathname === "/email/inbound" && method === "POST") {
    if (
      !rateLimiter.check(
        "email-inbound",
        RATE_LIMITS.webhook.limit,
        RATE_LIMITS.webhook.windowMs,
      )
    ) {
      logger.warn("server", "Rate limit hit for email inbound");
      return error("Too many requests. Try again later.", 429);
    }

    const resp = await handleEmailInbound(req);
    const body = await resp.text();
    return new Response(body, {
      status: resp.status,
      headers: {
        ...Object.fromEntries(resp.headers.entries()),
        ...corsHeaders,
      },
    });
  }

  // Discord webhook ingestion (auth via URL secret, not Bearer)
  const discordMatch = url.pathname.match(/^\/discord\/([^/]+)$/);
  if (discordMatch && method === "POST") {
    const channelId = discordMatch[1];

    // Rate limit: 60/min per channel (same as webhooks)
    if (
      !rateLimiter.check(
        `webhook:${channelId}`,
        RATE_LIMITS.webhook.limit,
        RATE_LIMITS.webhook.windowMs,
      )
    ) {
      logger.warn("server", "Rate limit hit for Discord webhook", {
        channelId,
      });
      return error("Too many webhook requests. Try again later.", 429);
    }

    const resp = await handleDiscordWebhook(channelId, req);
    const body = await resp.text();
    logger.info("server", "Discord webhook response", {
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
        } else if (data.type === "mcp-response") {
          // MCP response from extension — resolve the pending request
          if (data.correlationId && data.jsonrpc) {
            handleMcpResponse(data.correlationId, data.jsonrpc);
          }
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

  // ── MCP Server Endpoints ──
  const mcpMatch = url.pathname.match(/^\/mcp\/([^/]+)$/);
  if (mcpMatch) {
    const agentId = mcpMatch[1];
    const mcpRateKey = `mcp:${session.userId}`;

    if (!rateLimiter.check(mcpRateKey, 120, 60_000)) {
      return error("Too many MCP requests. Try again later.", 429);
    }

    if (method === "POST") {
      const resp = await handleMcpPost(agentId, req, session);
      // Add CORS headers
      for (const [k, v] of Object.entries(corsHeaders)) resp.headers.set(k, v);
      return resp;
    }
    if (method === "GET") {
      const resp = handleMcpGet(agentId, req, session);
      for (const [k, v] of Object.entries(corsHeaders)) resp.headers.set(k, v);
      return resp;
    }
    if (method === "DELETE") {
      const resp = await handleMcpDelete(agentId, req, session);
      for (const [k, v] of Object.entries(corsHeaders)) resp.headers.set(k, v);
      return resp;
    }
  }

  // MCP Agent Discovery endpoint
  if (url.pathname === "/mcp/agents" && method === "GET") {
    // Return list of agents — forward to extension
    pushToUser(session.userId, {
      type: "mcp-list-agents",
      correlationId: crypto.randomUUID(),
    });
    // For now, return a message directing the client to use /mcp/:agentId
    return json({
      info:
        "Use POST /mcp/{agentId} with JSON-RPC initialize to connect to a specific agent. Agent IDs are configured in the Chrome extension.",
    });
  }

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

  // Send a transient activity indicator (e.g. Telegram "typing") to the channel
  // so the user sees the agent is working. Best-effort; the client repeats it.
  if (url.pathname === "/typing" && method === "POST") {
    try {
      const body = await req.json();
      const channelId = body.channelId as string | undefined;
      const channelType = body.channelType as string | undefined;
      if (!channelId) return error("Missing channelId");

      if (channelType === "telegram") {
        const channel = session.channels.find((ch) => ch.id === channelId);
        if (!channel || channel.type !== "telegram") {
          return error("Channel not found", 404);
        }
        let botToken = channel.metadata["botTokenPlain"] as string | undefined;
        if (!botToken) {
          const encrypted = channel.metadata["botToken"] as string | undefined;
          if (encrypted) {
            try {
              const { decryptToken } = await import("./crypto.ts");
              botToken = await decryptToken(encrypted);
            } catch { /* fall through to no-op below */ }
          }
        }
        const { getReplyTarget } = await import("./store.ts");
        const chatId = await getReplyTarget(channelId);
        if (botToken && chatId) {
          const { sendTelegramChatAction } = await import(
            "./channels/telegram.ts"
          );
          await sendTelegramChatAction(botToken, chatId);
        }
      } else if (channelType === "discord") {
        const channel = session.channels.find((ch) => ch.id === channelId);
        if (!channel || channel.type !== "discord") {
          return error("Channel not found", 404);
        }
        let botToken = channel.metadata["botTokenPlain"] as string | undefined;
        if (!botToken) {
          const encrypted = channel.metadata["botToken"] as string | undefined;
          if (encrypted) {
            try {
              const { decryptToken } = await import("./crypto.ts");
              botToken = await decryptToken(encrypted);
            } catch { /* fall through to no-op below */ }
          }
        }
        const { getReplyTarget } = await import("./store.ts");
        const discordChannelId = await getReplyTarget(channelId);
        if (botToken && discordChannelId) {
          const { sendDiscordTyping } = await import("./channels/discord.ts");
          await sendDiscordTyping(botToken, discordChannelId);
        }
      }
      // Unknown / non-typing channel types are a no-op success.
      return json({ ok: true });
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
        direction: "bidirectional",
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

  // Register a Discord bot channel
  if (url.pathname === "/channels/discord/register" && method === "POST") {
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
        "Rate limit hit for Discord channel registration",
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

      const { botUsername, webhookSecret } = await registerDiscordBot(
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
        type: "discord",
        direction: "bidirectional",
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

      logger.info("server", "Discord bot channel registered", {
        userId: session.userId,
        channelId,
        botUsername,
        pairingCode,
      });
      return json({ channelId, botUsername, pairingCode }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("server", "Discord registration failed", {
        userId: session.userId,
        error: message,
      });
      return error(`Discord registration failed: ${message}`);
    }
  }

  // Register an Email channel
  if (url.pathname === "/channels/email/register" && method === "POST") {
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
        "Rate limit hit for email channel registration",
        { userId: session.userId },
      );
      return error(
        "Too many channel registration requests. Try again later.",
        429,
      );
    }

    try {
      const body = await req.json();
      const userEmail = body.userEmail;
      if (!userEmail || typeof userEmail !== "string") {
        return error("Missing or invalid userEmail");
      }
      // channelName seeds the inbound address slug; default it from the email's
      // local part when the client doesn't supply one.
      const channelName = (typeof body.channelName === "string" &&
          body.channelName.trim())
        ? body.channelName.trim()
        : (userEmail.split("@")[0].replace(/[^a-z0-9]+/gi, "-")
          .replace(/^-+|-+$/g, "").toLowerCase() || "agent");

      const domain = Deno.env.get("CHAOS_EMAIL_DOMAIN");
      if (!domain) {
        return error(
          "Email not configured (set CHAOS_EMAIL_DOMAIN env var)",
          503,
        );
      }

      const channelId = crypto.randomUUID();
      const serverBaseUrl = url.origin;

      const { inboundAddress, verificationToken } = await registerEmailChannel(
        session.userId,
        userEmail,
        channelName,
        domain,
        serverBaseUrl,
        channelId,
      );

      const channel: ChannelConfig = {
        id: channelId,
        type: "email",
        direction: "bidirectional",
        agentId: body.agentId || "",
        enabled: true,
        metadata: {
          userEmail,
          inboundAddress,
          verificationToken,
          verified: false,
          allowedSenders: [],
        },
      };

      await addChannel(session.userId, channel);

      logger.info("server", "Email channel registered (pending verification)", {
        userId: session.userId,
        channelId,
        userEmail,
        inboundAddress,
      });
      return json({ channelId, inboundAddress }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("server", "Email registration failed", {
        userId: session.userId,
        error: message,
      });
      return error(`Email registration failed: ${message}`);
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
      const channelType = body.type || "webhook";
      // Determine direction based on channel type
      const directionMap: Record<string, string> = {
        webhook: "inbound",
        telegram: "bidirectional",
        discord: "bidirectional",
        email: "bidirectional",
        slack: "bidirectional",
      };
      const channel: ChannelConfig = {
        id: body.id || crypto.randomUUID(),
        type: channelType,
        direction: (body.direction || directionMap[channelType] ||
          "inbound") as ChannelConfig["direction"],
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
      // Update top-level fields
      if (typeof body.name === "string") channel.name = body.name;
      if (typeof body.prompt === "string") channel.prompt = body.prompt;
      // Merge metadata updates (only allow safe fields)
      if (body.metadata) {
        if (Array.isArray(body.metadata.allowedUsers)) {
          channel.metadata["allowedUsers"] = body.metadata.allowedUsers.map(
            String,
          );
        }
        if (Array.isArray(body.metadata.allowedSenders)) {
          channel.metadata["allowedSenders"] = body.metadata.allowedSenders.map(
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

  const totalMs = Math.round(performance.now() - reqStart);
  logger.warn("server", "Route not found", { ...reqData, totalMs });
  return error("Not found", 404);
});

logger.info("server", "CHAOS relay server started", {
  port: PORT,
  version: VERSION,
});

// ── Admin HTML templates ──

function adminLoginHtml(errorMsg?: string): string {
  const errorDiv = errorMsg
    ? `<div class="error" role="alert">${errorMsg}</div>`
    : "";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Login | CHAOS Relay Admin</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#0f1117;color:#e1e4e8;display:flex;align-items:center;justify-content:center;min-height:100vh}
  main{width:100%;display:flex;justify-content:center}
  .card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:32px;width:100%;max-width:360px}
  h1{font-size:18px;margin-bottom:16px;color:#f0f3f6}
  label{display:block;font-size:12px;color:#8b949e;margin-bottom:6px}
  input{width:100%;padding:8px 12px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e1e4e8;font-size:14px;margin-bottom:12px}
  input:focus-visible{outline:2px solid #58a6ff;outline-offset:1px;border-color:#58a6ff}
  button{width:100%;padding:8px 12px;background:#238636;border:none;border-radius:6px;color:#fff;font-size:14px;cursor:pointer;font-weight:500}
  button:hover{background:#2ea043}
  button:focus-visible{outline:2px solid #58a6ff;outline-offset:2px}
  .error{color:#f85149;font-size:12px;margin-bottom:8px}
</style></head><body>
<main>
  <div class="card">
    <h1>CHAOS Relay Admin</h1>
    ${errorDiv}
    <form method="POST" action="/admin/login">
      <label for="admin-password">Admin password</label>
      <input id="admin-password" type="password" name="password" autocomplete="current-password" autofocus required>
      <button type="submit">Log in</button>
    </form>
  </div>
</main>
</body></html>`;
}

const ADMIN_DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard | CHAOS Relay Admin</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  .visually-hidden:where(:not(:focus-within,:active)){position:absolute!important;clip-path:inset(50%)!important;overflow:hidden!important;width:1px!important;height:1px!important;margin:-1px!important;padding:0!important;border:0!important;white-space:nowrap!important}
  :where(a:any-link,button,input,select,[tabindex]):focus-visible{outline:2px solid #58a6ff;outline-offset:2px}
  body{font-family:system-ui,sans-serif;background:#0f1117;color:#e1e4e8;padding:24px;max-width:1200px;margin:0 auto}
  h1{font-size:20px;margin-bottom:4px}
  .subtitle{color:#8b949e;font-size:13px;margin-bottom:24px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:24px}
  .stat{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
  .stat-value{font-size:24px;font-weight:600;color:#f0f3f6}
  .stat-label{font-size:11px;color:#8b949e;margin-top:4px;text-transform:uppercase;letter-spacing:0.5px}
  .stat-ok{color:#3fb950}.stat-warn{color:#d29922}.stat-err{color:#f85149}
  h2{font-size:16px;margin:24px 0 12px;color:#f0f3f6;display:flex;align-items:center;gap:12px}
  .card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:12px}
  .card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
  .card-title{font-size:14px;font-weight:600;color:#f0f3f6}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{text-align:left;padding:6px 10px;border-bottom:1px solid #30363d;color:#8b949e;font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:0.3px}
  td{padding:6px 10px;border-bottom:1px solid #21262d;vertical-align:top}
  .badge{display:inline-block;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:500;margin-right:4px}
  .badge-telegram{background:#2b5278;color:#7bc8f6}
  .badge-webhook{background:#2d3a2d;color:#7ee787}
  .badge-discord{background:#3b3f8a;color:#9ba3f5}
  .badge-email{background:#3a2d2d;color:#f5b79b}
  .badge-in{background:#1f3a1f;color:#7ee787}
  .badge-out{background:#3a1f1f;color:#f0883e}
  .badge-paired{background:#1a3a1a;color:#3fb950}
  .badge-pending{background:#3a3a1a;color:#d29922}
  .channel-detail{font-size:11px;color:#8b949e;margin-top:2px}
  .topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
  .btn{background:none;border:1px solid #30363d;border-radius:6px;color:#8b949e;padding:4px 12px;cursor:pointer;font-size:12px}
  .btn:hover{color:#f0f3f6;border-color:#8b949e}
  .btn-primary{color:#58a6ff;border-color:#58a6ff}
  .btn-primary:hover{background:#58a6ff22}
  .btn-danger{color:#f85149;border-color:#f85149}
  .btn-danger:hover{background:#f8514922}
  .btn-sm{padding:2px 8px;font-size:10px}
  #status{font-size:11px;color:#8b949e}
  .msg-content{max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace;font-size:11px}
  .ts{font-size:11px;color:#8b949e;font-family:monospace}
  code{background:#21262d;padding:1px 4px;border-radius:3px;font-size:11px}
  .search-box{background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e1e4e8;padding:6px 12px;font-size:13px;width:260px}
  .search-box:focus{border-color:#58a6ff}
  .search-box:focus-visible{outline:2px solid #58a6ff;outline-offset:2px;border-color:#58a6ff}
  .search-box::placeholder{color:#484f58}
  .pager{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:12px;color:#8b949e}
  .pager-info{flex:1}
  dialog{background:#161b22;color:#e1e4e8;border:1px solid #30363d;border-radius:12px;padding:0;max-width:800px;width:90vw;max-height:85vh;overflow:hidden;position:fixed;inset:0;margin:auto}
  dialog::backdrop{background:rgba(0,0,0,0.6)}
  #confirm-dialog{max-width:420px}
  .dialog-header{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #30363d}
  .dialog-header h2{font-size:15px;color:#f0f3f6;margin:0}
  .dialog-body{padding:20px;overflow-y:auto;max-height:calc(85vh - 60px)}
  .dialog-close{background:none;border:none;color:#8b949e;cursor:pointer;font-size:18px;padding:4px 8px;border-radius:4px}
  .dialog-close:hover{color:#f0f3f6;background:#21262d}
  .msg-row{padding:10px 0;border-bottom:1px solid #21262d;font-size:12px}
  .msg-row:last-child{border-bottom:none}
  .msg-meta{display:flex;gap:8px;align-items:center;margin-bottom:4px}
  .msg-body{font-family:monospace;font-size:11px;color:#c9d1d9;white-space:pre-wrap;word-break:break-word;max-height:200px;overflow-y:auto;background:#0d1117;padding:8px;border-radius:4px;margin-top:6px}
  .empty{color:#8b949e;text-align:center;padding:24px;font-size:13px}
  .section-controls{display:flex;align-items:center;gap:8px}
</style></head><body>
<header class="topbar">
  <div><h1>CHAOS Relay Admin</h1><div class="subtitle">Server dashboard — auto-refreshes every 10s</div></div>
  <div>
    <span id="status" role="status" aria-live="polite"></span>
    <button class="btn btn-primary" type="button" onclick="load()" style="margin-right:4px">Refresh</button>
    <form action="/admin/logout" method="POST" style="display:inline"><button class="btn" type="submit">Logout</button></form>
  </div>
</header>
<main>
<div class="grid" id="stats"></div>

<h2>Sessions &amp; Channels <search class="section-controls"><label class="visually-hidden" for="session-search">Filter sessions</label><input type="search" class="search-box" id="session-search" placeholder="Filter sessions..." oninput="filterSessions()"></search></h2>
<div id="sessions"></div>
<div class="pager" id="session-pager"></div>

<h2>Recent Messages <search class="section-controls"><label class="visually-hidden" for="msg-search">Filter messages</label><input type="search" class="search-box" id="msg-search" placeholder="Filter messages..." oninput="filterMessages()"></search></h2>
<table><thead><tr><th scope="col">Time</th><th scope="col">Dir</th><th scope="col">From</th><th scope="col">Channel</th><th scope="col">User</th><th scope="col">Content</th></tr></thead><tbody id="messages"></tbody></table>
<div class="pager" id="msg-pager"></div>

<h2>KV Browser</h2>
<div style="display:flex;gap:8px;margin-bottom:12px;align-items:center;">
  <label class="visually-hidden" for="kv-prefix">Key prefix</label>
  <select id="kv-prefix" class="search-box" style="width:180px;">
    <option value="">Loading prefixes...</option>
  </select>
  <label class="visually-hidden" for="kv-limit">Maximum entries</label>
  <input type="number" id="kv-limit" value="50" min="1" max="200" style="width:70px;padding:6px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e1e4e8;font-size:13px;">
  <button class="btn btn-primary" type="button" onclick="browseKv()">Browse</button>
  <span id="kv-status" role="status" aria-live="polite" style="font-size:11px;color:#8b949e;"></span>
</div>
<div id="kv-results" style="max-height:400px;overflow-y:auto;">
  <table><thead><tr><th scope="col">Key</th><th scope="col">Value</th></tr></thead><tbody id="kv-entries"></tbody></table>
</div>
</main>

<dialog id="session-dialog" closedby="any" aria-labelledby="dialog-title">
  <div class="dialog-header">
    <h2 id="dialog-title">Session Messages</h2>
    <button class="dialog-close" type="button" aria-label="Close dialog" onclick="document.getElementById('session-dialog').close()">&times;</button>
  </div>
  <div class="dialog-body" id="dialog-body"></div>
</dialog>

<dialog id="confirm-dialog" closedby="any" aria-labelledby="confirm-title">
  <div class="dialog-header">
    <h2 id="confirm-title">Confirm</h2>
    <button class="dialog-close" type="button" aria-label="Close dialog" onclick="document.getElementById('confirm-dialog').close()">&times;</button>
  </div>
  <div class="dialog-body">
    <p id="confirm-message" style="margin:0 0 20px"></p>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button type="button" class="btn btn-sm" id="confirm-cancel">Cancel</button>
      <button type="button" class="btn btn-sm" id="confirm-ok">OK</button>
    </div>
  </div>
</dialog>

<script>
const PAGE_SIZE = 10;
const MSG_PAGE_SIZE = 20;
let allSessions = [];
let allMessages = [];
let sessionPage = 0;
let msgPage = 0;
let sessionFilter = '';
let msgFilter = '';

function esc(s){if(s==null)return'';const d=document.createElement('div');d.textContent=String(s);return d.innerHTML}
function ago(ts){const s=Math.floor((Date.now()-new Date(ts).getTime())/1000);if(s<60)return s+'s ago';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago'}

// Accessible modal replacement for native confirm()/alert(): a <dialog> shown
// with showModal() (native focus-trap + Esc-to-close), light-dismissable via
// closedby="any". Resolves true on confirm, false on cancel/dismiss.
function modal({message,okLabel='OK',danger=false,showCancel=true}){
  return new Promise(resolve=>{
    const dlg=document.getElementById('confirm-dialog');
    document.getElementById('confirm-message').textContent=message;
    const ok=document.getElementById('confirm-ok');
    const cancel=document.getElementById('confirm-cancel');
    ok.textContent=okLabel;
    ok.classList.toggle('btn-danger',danger);
    cancel.style.display=showCancel?'':'none';
    let done=false;
    const finish=v=>{if(done)return;done=true;ok.removeEventListener('click',onOk);cancel.removeEventListener('click',onCancel);dlg.removeEventListener('close',onClose);if(dlg.open)dlg.close();resolve(v)};
    const onOk=()=>finish(true);
    const onCancel=()=>finish(false);
    const onClose=()=>finish(false); // Esc, backdrop, or the × button
    ok.addEventListener('click',onOk);
    cancel.addEventListener('click',onCancel);
    dlg.addEventListener('close',onClose);
    dlg.showModal();
    (showCancel?cancel:ok).focus(); // default focus to the non-destructive action
  });
}
function fmtTime(ts){return new Date(ts).toLocaleString()}

function matchSession(s,q){
  if(!q)return true;
  q=q.toLowerCase();
  if(s.userId.toLowerCase().includes(q))return true;
  for(const ch of s.channels){
    if(ch.type.includes(q))return true;
    if(ch.id.toLowerCase().includes(q))return true;
    if((ch.botUsername||'').toLowerCase().includes(q))return true;
    if((ch.inboundAddress||'').toLowerCase().includes(q))return true;
  }
  return false;
}

function matchMessage(m,q){
  if(!q)return true;
  q=q.toLowerCase();
  return m.from.toLowerCase().includes(q)||m.channelType.toLowerCase().includes(q)||
    m.channelId.toLowerCase().includes(q)||m.userId.toLowerCase().includes(q)||
    m.content.toLowerCase().includes(q)||m.direction.toLowerCase().includes(q);
}

function renderSessions(){
  const filtered=allSessions.filter(s=>matchSession(s,sessionFilter));
  const total=filtered.length;
  const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
  sessionPage=Math.min(sessionPage,pages-1);
  const start=sessionPage*PAGE_SIZE;
  const page=filtered.slice(start,start+PAGE_SIZE);

  const sc=document.getElementById('sessions');
  if(page.length===0){
    sc.innerHTML='<div class="empty">No sessions'+(sessionFilter?' matching "'+esc(sessionFilter)+'"':'')+'</div>';
  } else {
    sc.innerHTML=page.map(s=>{
      const wsStatus=s.wsConnections>0?'<span class="stat-ok">'+s.wsConnections+' connected</span>':'<span style="color:#8b949e">disconnected</span>';
      const channels=s.channels.length===0?'<div style="color:#8b949e;font-size:12px;padding:4px 0">No channels</div>':
        s.channels.map(ch=>{
          let detail='<code>'+esc(ch.id.slice(0,12))+'</code>';
          if(ch.type==='telegram'){
            detail+=' @'+esc(ch.botUsername||'?');
            if(ch.hasPairingCode)detail+=' <span class="badge badge-pending">awaiting pairing</span>';
            else if(ch.allowedUsers&&ch.allowedUsers.length>0)detail+=' <span class="badge badge-paired">'+ch.allowedUsers.length+' user(s)</span>';
            else detail+=' <span class="badge badge-pending">open</span>';
          }else if(ch.type==='email'){
            detail+=' '+esc(ch.inboundAddress||'');
            detail+=' '+(ch.verified?'<span class="badge badge-paired">verified</span>':'<span class="badge badge-pending">unverified</span>');
            if(ch.allowedSenders&&ch.allowedSenders.length>0)detail+=' <span class="badge badge-paired">'+ch.allowedSenders.length+' sender(s)</span>';
          }else if(ch.type==='discord'){
            detail+=' '+(ch.botUsername?'@'+esc(ch.botUsername):'');
          }else{
            detail+=' <span class="badge badge-webhook">webhook</span>';
          }
          return '<div style="padding:4px 0;font-size:12px"><span class="badge badge-'+esc(ch.type)+'">'+esc(ch.type)+'</span> '+detail+'</div>';
        }).join('');
      return '<div class="card"><div class="card-header"><span class="card-title"><code>'+esc(s.userId.slice(0,12))+'...</code></span><span style="display:flex;align-items:center;gap:6px">'+wsStatus+
        ' <button type="button" class="btn btn-primary btn-sm" onclick="viewMessages(&apos;'+esc(s.userId)+'&apos;)">Messages</button>'+
        ' <button type="button" class="btn btn-danger btn-sm" onclick="delSession(&apos;'+esc(s.userId)+'&apos;)">Delete</button></span></div>'+
        '<div class="channel-detail">Created: '+fmtTime(s.createdAt)+' | Channels: '+s.channels.length+' | ID: <code>'+esc(s.userId)+'</code></div>'+
        '<div style="margin-top:8px">'+channels+'</div></div>';
    }).join('');
  }

  document.getElementById('session-pager').innerHTML=total<=PAGE_SIZE?'':
    '<span class="pager-info">Showing '+(start+1)+'–'+Math.min(start+PAGE_SIZE,total)+' of '+total+'</span>'+
    '<button type="button" class="btn btn-sm" onclick="sessionPage=Math.max(0,sessionPage-1);renderSessions()"'+(sessionPage===0?' disabled':'')+'>Prev</button>'+
    '<button type="button" class="btn btn-sm" onclick="sessionPage=Math.min('+(pages-1)+',sessionPage+1);renderSessions()"'+(sessionPage>=pages-1?' disabled':'')+'>Next</button>';
}

function renderMessages(){
  const filtered=allMessages.filter(m=>matchMessage(m,msgFilter));
  const total=filtered.length;
  const pages=Math.max(1,Math.ceil(total/MSG_PAGE_SIZE));
  msgPage=Math.min(msgPage,pages-1);
  const start=msgPage*MSG_PAGE_SIZE;
  const page=filtered.slice(start,start+MSG_PAGE_SIZE);

  const mt=document.getElementById('messages');
  if(page.length===0){
    mt.innerHTML='<tr><td colspan="6" class="empty">No messages'+(msgFilter?' matching "'+esc(msgFilter)+'"':'')+'</td></tr>';
  } else {
    mt.innerHTML=page.map(m=>
      '<tr>'+
      '<td class="ts" title="'+esc(fmtTime(m.timestamp))+'">'+ago(m.timestamp)+'</td>'+
      '<td><span class="badge badge-'+m.direction+'">'+m.direction+'</span></td>'+
      '<td>'+esc(m.from)+'</td>'+
      '<td><span class="badge badge-'+esc(m.channelType)+'">'+esc(m.channelType)+'</span> '+esc(m.channelId)+'</td>'+
      '<td><code>'+esc(m.userId)+'</code></td>'+
      '<td class="msg-content" title="'+esc(m.content)+'">'+esc(m.content)+'</td>'+
      '</tr>'
    ).join('');
  }

  document.getElementById('msg-pager').innerHTML=total<=MSG_PAGE_SIZE?'':
    '<span class="pager-info">Showing '+(start+1)+'–'+Math.min(start+MSG_PAGE_SIZE,total)+' of '+total+'</span>'+
    '<button type="button" class="btn btn-sm" onclick="msgPage=Math.max(0,msgPage-1);renderMessages()"'+(msgPage===0?' disabled':'')+'>Prev</button>'+
    '<button type="button" class="btn btn-sm" onclick="msgPage=Math.min('+(pages-1)+',msgPage+1);renderMessages()"'+(msgPage>=pages-1?' disabled':'')+'>Next</button>';
}

function filterSessions(){
  sessionFilter=document.getElementById('session-search').value;
  sessionPage=0;
  renderSessions();
}

function filterMessages(){
  msgFilter=document.getElementById('msg-search').value;
  msgPage=0;
  renderMessages();
}

async function load(){
  const loadStart=Date.now();
  document.getElementById('status').textContent='Loading...';
  try{
    const fetchStart=Date.now();
    const r=await fetch('/admin/status');
    const fetchMs=Date.now()-fetchStart;
    if(r.status===401){location.href='/admin/login';return}
    const d=await r.json();

    // If server is still initializing, show status and retry quickly
    if(d.status==='initializing'||d.kvInitializing){
      document.getElementById('status').textContent='Server initializing... (retrying in 2s)';
      document.getElementById('stats').innerHTML='<div class="stat"><div class="stat-value stat-warn">Initializing</div><div class="stat-label">Deno KV</div></div>';
      setTimeout(load,2000);
      return;
    }

    document.getElementById('stats').innerHTML=
      '<div class="stat"><div class="stat-value '+(d.kv?'stat-ok':'stat-err')+'">'+(d.kv?'Connected':'Offline')+(d.kvError?' *':'')+'</div><div class="stat-label">Deno KV</div></div>'+
      '<div class="stat"><div class="stat-value">'+d.websockets+'</div><div class="stat-label">WebSockets</div></div>'+
      '<div class="stat"><div class="stat-value">'+d.sessions.length+'</div><div class="stat-label">Sessions</div></div>'+
      '<div class="stat"><div class="stat-value">'+Math.floor(d.uptime/60)+'m</div><div class="stat-label">Uptime</div></div>'+
      '<div class="stat"><div class="stat-value">'+(d.queryMs||'?')+'ms</div><div class="stat-label">Query Time</div></div>';

    allSessions=d.sessions;
    allMessages=d.recentMessages||[];
    renderSessions();
    renderMessages();

    document.getElementById('status').textContent='Updated '+new Date().toLocaleTimeString()+' (fetch: '+fetchMs+'ms, server: '+(d.queryMs||'?')+'ms)';
  }catch(e){
    document.getElementById('status').textContent='Error: '+e.message;
  }
}

async function viewMessages(userId){
  const dlg=document.getElementById('session-dialog');
  const body=document.getElementById('dialog-body');
  document.getElementById('dialog-title').textContent='Messages — '+userId.slice(0,12)+'...';
  body.innerHTML='<div class="empty">Loading...</div>';
  dlg.showModal();

  let cursor=undefined;
  let allMsgs=[];

  async function fetchPage(){
    const params=new URLSearchParams({limit:'50'});
    if(cursor)params.set('cursor',cursor);
    const r=await fetch('/admin/sessions/'+userId+'/messages?'+params);
    if(!r.ok){body.innerHTML='<div class="empty">Failed to load messages</div>';return}
    const d=await r.json();
    allMsgs=allMsgs.concat(d.messages);
    cursor=d.cursor;
    renderDrilldown();
  }

  function renderDrilldown(){
    if(allMsgs.length===0){
      body.innerHTML='<div class="empty">No messages for this session</div>';
      return;
    }
    body.innerHTML='<div style="margin-bottom:12px"><label class="visually-hidden" for="drill-search">Filter messages</label><input type="search" class="search-box" id="drill-search" placeholder="Filter messages..." oninput="drillFilter()" style="width:100%"></div>'+
      '<div id="drill-msgs"></div>'+
      (cursor?'<div style="text-align:center;margin-top:12px"><button type="button" class="btn btn-primary" id="drill-more">Load more</button></div>':'');
    drillFilter();
    if(cursor){document.getElementById('drill-more').onclick=fetchPage}
  }

  window.drillFilter=function(){
    const q=(document.getElementById('drill-search')?.value||'').toLowerCase();
    const filtered=q?allMsgs.filter(m=>
      m.content.toLowerCase().includes(q)||m.from.toLowerCase().includes(q)||
      m.channelType.toLowerCase().includes(q)||(m.channelId||'').toLowerCase().includes(q)
    ):allMsgs;
    const container=document.getElementById('drill-msgs');
    if(!container)return;
    if(filtered.length===0){container.innerHTML='<div class="empty">No messages matching "'+esc(q)+'"</div>';return}
    container.innerHTML=filtered.map(m=>{
      const dir=m.from==='agent'?'out':'in';
      return '<div class="msg-row">'+
        '<div class="msg-meta">'+
        '<span class="badge badge-'+dir+'">'+dir+'</span>'+
        '<span class="badge badge-'+esc(m.channelType)+'">'+esc(m.channelType)+'</span>'+
        '<span style="color:#8b949e">'+esc(m.from)+'</span>'+
        '<code>'+esc((m.channelId||'').slice(0,12))+'</code>'+
        '<span class="ts" title="'+esc(fmtTime(m.timestamp))+'">'+ago(m.timestamp)+'</span>'+
        '</div>'+
        '<div class="msg-body">'+esc(m.content)+'</div>'+
        '</div>';
    }).join('');
  };

  await fetchPage();
}

async function delSession(userId){
  if(!await modal({message:'Delete session '+userId.slice(0,12)+'…? This also removes its channels and cannot be undone.',okLabel:'Delete',danger:true}))return;
  const r=await fetch('/admin/sessions/'+userId,{method:'DELETE'});
  if(r.ok){load()}else{await modal({message:'Delete failed: '+(await r.json()).error,showCancel:false})}
}

load();
setInterval(load,10000);

// KV Browser
async function loadKvPrefixes(){
  try{
    const r=await fetch('/admin/kv/prefixes');
    if(!r.ok)return;
    const d=await r.json();
    const sel=document.getElementById('kv-prefix');
    sel.innerHTML='<option value="">(all keys)</option>'+
      (d.prefixes||[]).map(p=>'<option value="'+esc(p.prefix)+'">'+esc(p.prefix)+' ('+p.count+')</option>').join('');
  }catch{}
}
async function browseKv(){
  const prefix=document.getElementById('kv-prefix').value;
  const limit=document.getElementById('kv-limit').value||'50';
  const status=document.getElementById('kv-status');
  status.textContent='Loading...';
  try{
    const r=await fetch('/admin/kv?prefix='+encodeURIComponent(prefix)+'&limit='+limit);
    const d=await r.json();
    status.textContent=d.count+' entries ('+d.ms+'ms)';
    const tbody=document.getElementById('kv-entries');
    tbody.innerHTML=(d.entries||[]).map(e=>
      '<tr><td style="font-family:monospace;font-size:11px;white-space:nowrap;">'+esc(e.key.join(' / '))+'</td>'+
      '<td style="font-family:monospace;font-size:11px;max-width:500px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="'+esc(JSON.stringify(e.value))+'">'+esc(JSON.stringify(e.value).slice(0,200))+'</td></tr>'
    ).join('')||'<tr><td colspan="2" style="color:#8b949e;text-align:center;">No entries</td></tr>';
  }catch(e){
    status.textContent='Error: '+e.message;
  }
}
loadKvPrefixes();
</script></body></html>`;
